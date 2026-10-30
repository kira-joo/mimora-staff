import { notifyOrderLifecycle } from "../../notifications/order-lifecycle";
import { notifyStockAfterOrder } from "../../notifications/low-stock";
import { ConflictError, NotFoundError, UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import { resolveLocalized } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import {
  cartRepository,
  cartLineRepository,
  deliveryZoneRepository,
  fulfilmentSettingsRepository,
  orderRepository,
  pageRepository,
  paymentSettingsRepository,
  pickupLocationRepository,
} from "../../core/repositories";
import { loadOperatingSchedule } from "../../fulfilment/load-operating-schedule";
import { storeTimeZone } from "../../core/config/store-timezone";
import { placeOrder } from "../../engines/order-placement/place-order";
import type { PlaceOrderInput } from "../../engines/order-placement/place-order.types";
import type { ShippingZoneConfig } from "../../engines/shipping/shipping.types";
import { cartFilterForActor } from "../cart/cart-actor-filter";
import { TERMS_PAGE_SLUG } from "../../content/legal-pages";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";
import type { ShopActor } from "../shop-actor";
import type { PlaceOrderView } from "./order.types";
import { CART_LINE_ORDER } from "../cart/cart-line-order";

/** A guest placing an order: the cart they hold the token for, and how to reach them. */
export interface GuestOrderer {
  cartToken: string;
  contact: { name: string; phone: string; email?: string };
}

export type PlaceOrderServiceInput = {
  paymentMethod: string;
  /** The customer's checkout note (`PlaceOrderDto.notes`, already trimmed). */
  notes?: string;
  /** The `terms` version the customer accepted — see `PlaceOrderDto.termsVersionAccepted`. */
  termsVersionAccepted: number;
  idempotencyKey: string;
  locale: "en" | "ar";
  now: Date;
} & ({ customer: CustomerIdentity; guest?: undefined } | { guest: GuestOrderer; customer?: undefined });

/**
 * Service layer for `POST /api/shop/orders` — orchestrates the placement
 * engine and maps the result to the customer-facing response shape.
 *
 * Reads cart + fulfilment settings, derives promotion context (customer
 * history, or the conservative guest default), calls the transactional `placeOrder` engine, and returns the
 * placed order with customer-facing fields like `promisedWindow`.
 *
 * **No transaction here** — the engine owns it. This layer is pure
 * orchestration + response mapping.
 */
export async function placeOrderService(input: PlaceOrderServiceInput): Promise<PlaceOrderView> {
  const { customer, guest, paymentMethod, notes, termsVersionAccepted, idempotencyKey, locale, now } = input;
  const actor: ShopActor = customer ? { kind: "customer", customer } : { kind: "guest", cartToken: guest.cartToken };

  // A store that turned guest checkout off answers a guest exactly as it
  // answers any unauthenticated request to an account-only route.
  if (guest) {
    const settings = await fulfilmentSettingsRepository.findOne({ where: {}, skipThrowError: true });
    if (settings && !settings.allowGuestCheckout) throw new UnauthorizedError("Sign in to continue.");
  }

  const cart = await cartRepository.findOne({
    where: cartFilterForActor(actor),
    lean: true,
  });
  if (!cart) throw new NotFoundError("No cart exists yet — add a line first.");

  const cartLines = await cartLineRepository.findAll({ where: { cartId: cart._id }, sort: CART_LINE_ORDER, lean: true });
  if (cartLines.length === 0) throw new ConflictError("This cart has no lines to order.");

  await assertAcceptedCurrentTerms(termsVersionAccepted);

  if (!cart.fulfilmentDraft) {
    throw new ConflictError("Fulfilment information required to place an order.");
  }

  // PICKUP mode requires a valid pickup location. Its name/address are
  // LocalizedString on PickupLocationSchema; Order.fulfilment.pickupLocationSnapshot
  // stores plain strings, so they're resolved to the placing customer's
  // locale here — the same resolution the main engine already does for
  // productName/variantDescription.
  let pickupLocationSnapshot: PlaceOrderInput["fulfilment"]["pickupLocationSnapshot"];
  if (cart.fulfilmentDraft.mode === "PICKUP") {
    if (!cart.fulfilmentDraft.pickupLocationId) {
      throw new ConflictError("Pickup location required for pickup fulfilment.");
    }
    const pickupLocation = await pickupLocationRepository.findOne({
      where: { _id: cart.fulfilmentDraft.pickupLocationId },
      skipThrowError: true,
      lean: true,
    });
    if (!pickupLocation) throw new NotFoundError("Invalid pickup location.");
    pickupLocationSnapshot = {
      name: resolveLocalized(pickupLocation.name, locale),
      address: resolveLocalized(pickupLocation.address, locale),
      phone: pickupLocation.phone,
    };
  }

  // DELIVERY mode requires an address
  if (cart.fulfilmentDraft.mode === "DELIVERY" && !cart.fulfilmentDraft.address) {
    throw new ConflictError("Delivery address required for delivery fulfilment.");
  }

  // Read fulfilment settings
  const fulfilmentSettings = await fulfilmentSettingsRepository.findOne({ where: {}, skipThrowError: true });
  if (!fulfilmentSettings) throw new NotFoundError("Fulfilment settings not configured.");

  // Build shipping zones for delivery
  let zones: ShippingZoneConfig[] = [];
  if (fulfilmentSettings.shippingFeeMode === "BY_ZONE") {
    const deliveryZones = await deliveryZoneRepository.findAll({ where: { active: true } });
    zones = deliveryZones.map((zone) => ({
      zone: zone.name.en,
      label: resolveLocalized(zone.name, locale),
      zoneId: zone._id.toString(),
      fee: zone.fee,
      estimatedDays: zone.leadDays,
      estimatedDaysMin: zone.leadDaysMin ?? undefined,
      minimumOrder: zone.minimumOrder,
    }));
  }

  // Build fulfilment snapshot.
  const fulfilmentInput: PlaceOrderInput["fulfilment"] = {
    mode: cart.fulfilmentDraft.mode,
    zoneName: cart.fulfilmentDraft.address?.governorate,
    addressSnapshot:
      cart.fulfilmentDraft.mode === "DELIVERY" && cart.fulfilmentDraft.address
        ? {
            recipientName: cart.fulfilmentDraft.address.recipientName,
            phone: cart.fulfilmentDraft.address.phone,
            addressLine1: cart.fulfilmentDraft.address.addressLine1,
            addressLine2: cart.fulfilmentDraft.address.addressLine2,
            city: cart.fulfilmentDraft.address.city,
            // The storefront submits the zone's English name as the matching key (`zoneName` above);
            // what the customer reads back in their order is the zone's name in their own locale.
            governorate: zones.find((zone) => zone.zone === cart.fulfilmentDraft!.address!.governorate)?.label ?? cart.fulfilmentDraft.address.governorate,
            postalCode: cart.fulfilmentDraft.address.postalCode,
          }
        : undefined,
    pickupLocationSnapshot,
  };

  // Validate the requested payment method against the merchant's configured
  // PaymentSettings.methods[] — the mechanism `Order.payment`'s own schema
  // doc comment and `PlaceOrderInput.paymentMethod`'s doc comment both
  // already anticipated ("validated against PaymentSettings.methods[] at
  // the route layer"). `paymentMethod` stays a plain, open string (D-6) —
  // this validates it against configuration, it does not constrain it to a
  // fixed union.
  const paymentSettings = await paymentSettingsRepository.findOne({ where: {}, skipThrowError: true });
  const paymentMethodConfig = paymentSettings?.methods.find((method) => method.method === paymentMethod && method.enabled);
  if (!paymentMethodConfig) {
    throw new NotFoundError(`Payment method "${paymentMethod}" is not available.`);
  }

  // Build PlaceOrderInput
  const placeOrderInput: PlaceOrderInput = {
    cartId: cart._id,
    ...(customer ? { customerId: new mongoose.Types.ObjectId(customer._id) } : { guestContact: guest.contact }),
    idempotencyKey,
    ...(notes ? { notes } : {}),
    fulfilment: fulfilmentInput,
    paymentMethod,
    termsVersionAccepted,
    requiresPaymentProof: paymentMethodConfig.requiresProof,
    requiresProviderIntegration: paymentMethodConfig.requiresProviderIntegration,
    paymentDestination: paymentMethodConfig.destination,
    paymentInstructions: paymentMethodConfig.instructions,
    now,
    tax: {
      mode: fulfilmentSettings.tax.mode,
      rate: fulfilmentSettings.tax.rate,
    },
    shippingSettings: {
      zones,
      deliveryEnabled: fulfilmentSettings.deliveryEnabled,
      pickupEnabled: fulfilmentSettings.pickupEnabled,
      shippingFeeMode: fulfilmentSettings.shippingFeeMode,
      flatShippingFee: fulfilmentSettings.flatShippingFee,
      defaultDispatchLeadDays: fulfilmentSettings.defaultDispatchLeadDays,
      cutoffTime: fulfilmentSettings.cutoffTime,
      storeWideOrderMinimum: fulfilmentSettings.orderMinimum,
      timeZone: storeTimeZone(),
      operatingHours: await loadOperatingSchedule(),
      maxDaysAhead: fulfilmentSettings.maxDaysAhead,
      shippingDays: fulfilmentSettings.shippingDays ?? undefined,
      customerCancelWindowMinutes: fulfilmentSettings.customerCancelWindowMinutes,
    },
    locale,
  };

  // Call the transactional placement engine
  const result = await placeOrder(placeOrderInput);

  // Map to customer-facing view. promisedWindow is built by the engine but
  // not returned in PlacedOrderResult — read it back from the created order.
  const createdOrder = await orderRepository.findOne({ where: { orderNumber: result.orderNumber }, skipThrowError: true });
  if (!createdOrder) throw new Error("Order vanished after creation.");

  // The order is committed. Tell the customer (if the merchant switched it on) and staff — neither can fail the order.
  await notifyOrderLifecycle(createdOrder._id, { type: "ORDER_PLACED" });
  await notifyStockAfterOrder(createdOrder._id);

  return {
    orderId: result.orderId.toString(),
    orderNumber: result.orderNumber,
    subtotal: result.subtotal,
    discount: result.discount,
    tax: result.tax,
    total: result.total,
    status: result.status as PlaceOrderView["status"],
    paymentStatus: result.paymentStatus as PlaceOrderView["paymentStatus"],
    promisedWindow: createdOrder.fulfilment.promisedWindow,
  };
}

/**
 * D-13: an order records the terms version the customer accepted, so the
 * version they accepted must be the one that is live. A stale version means
 * the terms changed while they were checking out — recording it would claim
 * acceptance of text they never saw, and recording the new one would claim
 * acceptance of text they never read. Either way they are asked again.
 *
 * No published terms page means there is nothing to accept, and the store
 * cannot take an order that records acceptance — refused loudly rather than
 * placing an order with no terms on it.
 */
async function assertAcceptedCurrentTerms(acceptedVersion: number): Promise<void> {
  const terms = await pageRepository.findOne({ where: { slug: TERMS_PAGE_SLUG, published: true }, skipThrowError: true, lean: true });
  if (!terms) {
    throw new ConflictError("This store has not published its terms of sale, so it cannot take orders yet.", { field: "termsVersionAccepted", reason: "TERMS_NOT_PUBLISHED" });
  }
  const currentVersion = terms.version ?? 1;
  if (acceptedVersion !== currentVersion) {
    throw new ConflictError("The terms of sale have changed since you accepted them. Please review and accept the current terms.", {
      field: "termsVersionAccepted",
      reason: "TERMS_VERSION_CHANGED",
      currentVersion,
    });
  }
}
