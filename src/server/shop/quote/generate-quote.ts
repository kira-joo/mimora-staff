import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { ZERO, resolveLocalized, sum } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import {
  cartRepository,
  cartLineRepository,
  deliveryZoneRepository,
  fulfilmentSettingsRepository,
  variantRepository,
  productRepository,
  pickupLocationRepository,
} from "../../core/repositories";
import { calculatePricing } from "../../engines/pricing/calculate-pricing";
import type { AppliedDiscount } from "../../engines/pricing/pricing.types";
import { resolvePurchasability } from "../../engines/purchasability/resolve-purchasability";
import { meetsOrderMinimum, resolveShipping } from "../../engines/shipping/resolve-shipping";
import type { ShippingZoneConfig } from "../../engines/shipping/shipping.types";
import { loadOperatingSchedule } from "../../fulfilment/load-operating-schedule";
import { storeTimeZone } from "../../core/config/store-timezone";
import { resolveOrderPromotion } from "../order/resolve-order-promotion";
import { cartFilterForActor } from "../cart/cart-actor-filter";
import type { ShopActor } from "../shop-actor";
import type { QuoteLineView, QuoteUnavailableReason, QuoteView } from "./quote.types";
import { resolveLineImage, resolveOptionLabels } from "./quote-line-display";
import { CART_LINE_ORDER } from "../cart/cart-line-order";

export interface GenerateQuoteInput {
  actor: ShopActor;
  locale: "en" | "ar";
  now: Date;
}

/**
 * Authoritative pricing for the current cart + fulfilment.
 *
 * Read-only, ephemeral preview of what order placement would calculate. Uses
 * the exact same engines — pricing, promotion evaluation, purchasability,
 * shipping — so the quote is the honest answer to "what will I pay?"
 *
 * **No transaction, no idempotency, no cache invalidation.** Quote writes
 * nothing and reserves nothing. Calling it twice with the same cart state
 * returns the same result.
 *
 * **Re-checks purchasability authoritatively** — the storefront's own
 * client-side check and the variant matrix engine's render-time check are
 * both advisory. This is the check that actually gates the order.
 *
 * **Silently drops an inapplicable promotion** (expired, usage limit
 * reached, conditions not met) rather than blocking the quote — same as
 * order placement. The customer is not at fault for a campaign ending
 * mid-checkout.
 */
export async function generateQuote(input: GenerateQuoteInput): Promise<QuoteView> {
  const { actor, locale, now } = input;

  // A guest with no cart token has no cart by definition — an empty quote, not the 401 `cartFilterForActor` raises for mutations.
  if (actor.kind === "guest" && !actor.cartToken) return emptyQuote();

  const cart = await cartRepository.findOne({ where: cartFilterForActor(actor), lean: true, skipThrowError: true });
  const cartLines = cart ? await cartLineRepository.findAll({ where: { cartId: cart._id }, sort: CART_LINE_ORDER, lean: true }) : [];

  // No cart yet, or an empty one: the cart page renders its empty state from
  // this one call, so it is a valid quote at zero — never a 404/409.
  if (!cart || cartLines.length === 0) return emptyQuote();

  const variantIds = cartLines.map((line) => line.variantId);
  const variants = await variantRepository.findAll({ where: { _id: { $in: variantIds } }, lean: true });
  const variantById = new Map(variants.map((variant) => [variant._id.toString(), variant]));

  const productIds = [...new Set(variants.map((variant) => variant.productId.toString()))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  const products = await productRepository.findAll({ where: { _id: { $in: productIds } }, lean: true });
  const productById = new Map(products.map((product) => [product._id.toString(), product]));

  // Re-check purchasability authoritatively, per line. An unavailable line is
  // reported (and excluded from every total) rather than failing the whole
  // quote — the cart page must still show it so the customer can remove it.
  // Placement runs the same check and still refuses with 409.
  const availability = cartLines.map((line): QuoteUnavailableReason | null => {
    const variant = variantById.get(line.variantId.toString());
    if (!variant) return "DISCONTINUED";
    const product = productById.get(variant.productId.toString());
    if (!product) return "NOT_PUBLISHED";

    const purchasability = resolvePurchasability({
      productLifecycle: product.lifecycle,
      discontinued: variant.discontinued,
      stock: variant.stock,
      backorderPolicy: variant.backorderPolicy,
      requestedQuantity: line.quantity,
    });
    return purchasability.purchasable ? null : purchasability.reason;
  });
  const availableLines = cartLines.filter((_, index) => availability[index] === null);

  // Subtotal covers available lines only.
  const pricingLines = availableLines.map((line) => {
    const variant = variantById.get(line.variantId.toString())!;
    return { unitBasePrice: variant.price, quantity: line.quantity };
  });
  const subtotal = sum(pricingLines.map((line) => line.unitBasePrice.mul(line.quantity)));

  // Tax mode comes from settings whether or not shipping can be resolved yet.
  const fulfilmentSettings = await fulfilmentSettingsRepository.findOne({ where: {}, skipThrowError: true });
  if (!fulfilmentSettings) throw new NotFoundError("Fulfilment settings not configured.");

  // Fulfilment is optional here: before the customer chooses it, shipping is
  // pending and the total excludes it. With nothing buyable there is nothing to
  // ship, so it stays pending too.
  const draft = availableLines.length > 0 ? cart.fulfilmentDraft : undefined;
  let shippingResult: Extract<ReturnType<typeof resolveShipping>, { resolvable: true }> | undefined;

  if (draft) {
    // PICKUP mode requires a valid pickup location
    if (draft.mode === "PICKUP") {
      if (!draft.pickupLocationId) {
        throw new ConflictError("Pickup location required for pickup fulfilment.");
      }
      const location = await pickupLocationRepository.findOne({ where: { _id: draft.pickupLocationId }, skipThrowError: true });
      if (!location) throw new NotFoundError("Invalid pickup location.");
    }

    // DELIVERY mode requires an address
    if (draft.mode === "DELIVERY" && !draft.address) {
      throw new ConflictError("Delivery address required for delivery fulfilment.");
    }

    let zones: ShippingZoneConfig[] = [];
    if (fulfilmentSettings.shippingFeeMode === "BY_ZONE") {
      const deliveryZones = await deliveryZoneRepository.findAll({ where: { active: true } });
      zones = deliveryZones.map((zone) => ({
        zone: zone.name.en,
        zoneId: zone._id.toString(),
        fee: zone.fee,
        estimatedDays: zone.leadDays,
        minimumOrder: zone.minimumOrder,
      }));
    }

    const resolved = resolveShipping({
      mode: draft.mode,
      zoneName: draft.address?.governorate,
      zones,
      deliveryEnabled: fulfilmentSettings.deliveryEnabled,
      pickupEnabled: fulfilmentSettings.pickupEnabled,
      shippingFeeMode: fulfilmentSettings.shippingFeeMode,
      flatShippingFee: fulfilmentSettings.flatShippingFee,
      defaultDispatchLeadDays: fulfilmentSettings.defaultDispatchLeadDays,
      cutoffTime: fulfilmentSettings.cutoffTime,
      placedAt: now,
      timeZone: storeTimeZone(),
      operatingHours: await loadOperatingSchedule(),
      maxDaysAhead: fulfilmentSettings.maxDaysAhead,
      storeWideOrderMinimum: fulfilmentSettings.orderMinimum,
    });

    if (!resolved.resolvable) {
      throw new ConflictError(`Fulfilment is not available (${resolved.reason}).`);
    }

    if (!meetsOrderMinimum(subtotal, resolved.orderMinimum)) {
      throw new ConflictError("This order is below the minimum for the selected fulfilment option.");
    }
    shippingResult = resolved;
  }

  const shippingFee = draft?.mode === "DELIVERY" && shippingResult ? shippingResult.fee : undefined;

  // The one promotion choice placement makes too (resolve-order-promotion.ts) — the cart's code and
  // every active automatic promotion, same engine, same fee — so the quoted total is the charged total.
  const resolved = await resolveOrderPromotion({
    code: cart.appliedPromotionCode,
    customerId: actor.kind === "customer" ? actor.customer._id : undefined,
    now,
    subtotal,
    shippingFee,
    lines: availableLines.map((line) => {
      const variant = variantById.get(line.variantId.toString())!;
      const product = productById.get(variant.productId.toString())!;
      return {
        categoryId: product.categoryId.toString(),
        collectionIds: product.collectionIds.map(String),
        productId: product._id.toString(),
        variantId: variant._id.toString(),
        lineTotal: variant.price.mul(line.quantity),
      };
    }),
  });
  const discount: AppliedDiscount | undefined = resolved?.evaluation.effect;
  const promotionView: QuoteView["promotion"] = resolved
    ? {
        code: resolved.promotion.code ?? "",
        automatic: resolved.automatic,
        name: resolved.promotion.name,
        subtotalDiscount: resolved.evaluation.effect.subtotalDiscount,
        waivesShippingFee: resolved.evaluation.effect.waivesShippingFee,
      }
    : undefined;

  // Calculate final pricing
  const pricing = calculatePricing({
    lines: pricingLines,
    discount,
    shippingFee,
    tax: { mode: fulfilmentSettings.tax.mode, rate: fulfilmentSettings.tax.rate },
  });

  // Build response
  const lines: QuoteLineView[] = cartLines.map((line, index) => {
    const variant = variantById.get(line.variantId.toString());
    const product = variant ? productById.get(variant.productId.toString()) : undefined;
    const reason = availability[index];
    const pricedIndex = availableLines.indexOf(line);

    const productName = product ? resolveLocalized(product.name, locale) : "";
    const variantDescription = !variant
      ? ""
      : variant.optionValues.length > 0
        ? variant.optionValues.map((option) => option.value).join(" / ")
        : productName;

    return {
      lineId: line._id.toString(),
      variantId: line.variantId.toString(),
      productId: product ? product._id.toString() : "",
      productSlug: product?.slug ?? "",
      image: variant && product ? resolveLineImage(variant.galleryOverride, product.images) : null,
      optionLabels: variant && product ? resolveOptionLabels(variant.optionValues, product.optionAxes) : [],
      available: reason === null,
      ...(reason ? { unavailableReason: reason } : {}),
      sku: variant?.sku ?? "",
      productName,
      variantDescription,
      quantity: line.quantity,
      unitPrice: variant?.price ?? ZERO,
      // An unavailable line still shows what it would have cost, but never counts toward a total.
      lineTotal: pricedIndex >= 0 ? pricing.lines[pricedIndex].lineTotal : (variant?.price ?? ZERO).mul(line.quantity),
    };
  });

  return {
    lines,
    subtotal: pricing.subtotal,
    discount: pricing.discount,
    shippingFee: shippingResult ? pricing.shippingFee : null,
    tax: pricing.tax,
    total: pricing.total,
    promotion: promotionView,
    fulfilment:
      draft && shippingResult
        ? {
            mode: draft.mode,
            fee: shippingResult.fee,
            zone: shippingResult.zone,
            dispatchBy: shippingResult.dispatchBy,
            promisedWindow: shippingResult.promisedWindow,
          }
        : null,
    shippingPending: !shippingResult,
    hasUnavailableLines: availableLines.length < cartLines.length,
  };
}

function emptyQuote(): QuoteView {
  return {
    lines: [],
    subtotal: ZERO,
    discount: ZERO,
    shippingFee: null,
    tax: ZERO,
    total: ZERO,
    fulfilment: null,
    shippingPending: true,
    hasUnavailableLines: false,
  };
}
