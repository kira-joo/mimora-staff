import type { LocalizedString, Money } from "@kira-joo/toolkit-common";
import type mongoose from "mongoose";
import type { FulfilmentMode } from "../order-state/order-state.types";
import type { OperatingSchedule, ShippingZoneConfig } from "../shipping/shipping.types";

export interface PlaceOrderFulfilmentInput {
  mode: FulfilmentMode;
  /** Required when `mode` is `"DELIVERY"`. */
  addressSnapshot?: {
    recipientName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    governorate: string;
    postalCode?: string;
  };
  /** Required when `mode` is `"PICKUP"`. */
  pickupLocationSnapshot?: { name: string; address: string; phone: string };
  /** Delivery zone name to resolve fee and lead time from — `DELIVERY` only. */
  zoneName?: string;
}

export interface PlaceOrderInput {
  cartId: mongoose.Types.ObjectId;
  customerId?: mongoose.Types.ObjectId;
  guestContact?: { name: string; phone: string; email?: string };
  /**
   * The client-supplied `Idempotency-Key`. Snapshotted onto the order for
   * audit; the actual gate (has this key already produced a response?) is
   * the route layer's job via `IdempotencyRecordModel`, matching the
   * restaurant precedent — this engine only records what key was used.
   */
  idempotencyKey: string;
  /** The customer's checkout note — already trimmed by the caller; blank is the same as absent. Stored on `Order.notes`. */
  notes?: string;
  fulfilment: PlaceOrderFulfilmentInput;
  /**
   * A plain string, validated against `PaymentSettings.methods[].method` by
   * the caller (no route exists yet in this phase) — not a fixed union.
   * Phase 4A.5: the prior `"COD" | "WALLET" | "CARD"` union never matched
   * the storefront's own documented payment methods and had to be edited in
   * code for every configured method; see `Order.payment`'s doc comment.
   */
  paymentMethod: string;
  /**
   * D-13: the published `terms` version the customer accepted — checked
   * against the live version by the caller, recorded here with
   * `acceptedAt = now`. Required: an order cannot be placed without it.
   */
  termsVersionAccepted: number;
  /** Whether this payment method requires a manually-verified transfer proof — configuration, resolved by the caller. */
  requiresPaymentProof: boolean;
  /** Whether this payment method routes through a provider callback instead of manual verification — configuration, resolved by the caller. No provider integration exists yet (this phase); the flag only affects which `payment.status` the order starts in. */
  requiresProviderIntegration: boolean;
  /** Snapshotted onto `Order.payment.destinationSnapshot` at placement — resolved by the caller from `PaymentSettings.methods[].destination`. */
  paymentDestination?: { accountName?: string; number?: string; handle?: string };
  /** Snapshotted onto `Order.payment.instructionsSnapshot` — the customer-facing instructions for this method, frozen like the destination. */
  paymentInstructions?: LocalizedString;
  now: Date;
  // No `isFirstOrder` / `customerUses` inputs: they are derived INSIDE the placement transaction from
  // the customer's order history (derive-promotion-context.ts) — computed by the caller, before the
  // transaction, they let two concurrent orders both claim a first-order or per-customer-limited promotion.
  tax: { mode: "INCLUDED" | "ADDED"; rate: number };
  shippingSettings: {
    zones: ShippingZoneConfig[];
    deliveryEnabled: boolean;
    pickupEnabled: boolean;
    defaultDispatchLeadDays: number;
    cutoffTime?: string;
    shippingFeeMode: "FLAT" | "BY_ZONE";
    flatShippingFee?: Money;
    storeWideOrderMinimum?: Money;
    /** The store's IANA zone — see `ShippingInput.timeZone`. */
    timeZone: string;
    /** Loaded by `loadOperatingSchedule()`, the same loader the quote uses. */
    operatingHours: OperatingSchedule;
    /** `FulfilmentSettings.maxDaysAhead`. */
    maxDaysAhead: number;
    /** `FulfilmentSettings.shippingDays` — see `ShippingInput.shippingDays`. */
    shippingDays?: readonly number[];
    /** `FulfilmentSettings.customerCancelWindowMinutes` — `Order.customerCancelUntil` is `placedAt` plus this. */
    customerCancelWindowMinutes: number;
  };
  /**
   * Snapshotting `OrderLine.productName`/`variantDescription` as plain
   * strings (not `LocalizedString`) is a Phase 2 schema fact, not a Phase 3
   * choice — see the doc comment above the `resolveLocalized` call in
   * `place-order.ts`. This is the locale that resolution uses.
   */
  locale: "ar" | "en";
}

export interface PlacedOrderResult {
  orderId: mongoose.Types.ObjectId;
  orderNumber: string;
  subtotal: Money;
  discount: Money;
  tax: Money;
  total: Money;
  status: string;
  paymentStatus: string;
  /** Allocated inside the placement transaction — see `invoices/allocate-invoice-number.ts`. */
  invoiceNumber: string;
}
