import {
  MongoField,
  MongoSchema,
  Relation,
  Unique,
  moneyField,
  createMongoModel,
  localizedStringSchema,
} from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, Money } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * Order timeline event types — the business lifecycle, not a generic audit
 * trail. Distinct from `ActivityLog`: this records what happened to the
 * ORDER (meaningful for a customer or a support agent reading its history);
 * `ActivityLog` records who-did-what across every entity, for compliance.
 * An order's timeline is a strict subset of what could theoretically be
 * logged about it.
 */
export type OrderTimelineEventType =
  | "ORDER_PLACED"
  | "ORDER_CONFIRMED"
  | "ORDER_PROCESSING"
  | "ORDER_READY_FOR_PICKUP"
  | "ORDER_SHIPPED"
  /** Optional step after SHIPPED ("dispatched"): the courier has the parcel and it is moving. */
  | "ORDER_IN_TRANSIT"
  | "ORDER_DELIVERED"
  /** The terminal event for a PICKUP order — the customer collected it. */
  | "ORDER_COLLECTED"
  | "ORDER_CANCELLED"
  /** Staff added or corrected the carrier / tracking number after the order shipped. Staff-only: the customer sees the tracking itself. */
  | "ORDER_TRACKING_UPDATED"
  | "PAYMENT_SUBMITTED"
  | "PAYMENT_VERIFIED"
  | "PAYMENT_REJECTED"
  | "PAYMENT_REFUNDED"
  | "RETURN_REQUESTED"
  | "RETURN_APPROVED"
  | "RETURN_REJECTED"
  | "RETURN_RECEIVED"
  | "REFUND_ISSUED";

const orderTimelineEntrySchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    at: { type: Date, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, required: false },
    actorType: { type: String, enum: ["STAFF", "CUSTOMER", "SYSTEM"], required: true },
    reason: { type: String, required: false },
    metadata: { type: mongoose.Schema.Types.Mixed, required: false },
  },
  { _id: false }
);

export interface OrderTimelineEntry {
  type: OrderTimelineEventType;
  at: Date;
  actorId?: mongoose.Types.ObjectId;
  actorType: "STAFF" | "CUSTOMER" | "SYSTEM";
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Order.
 *
 * Idempotency key is scoped by route and actor before uniqueness (not raw globally-unique).
 * Order lines snapshot everything — including SKU, payment destination, shipping, promotion.
 *
 * **Order status and payment status are separate axes** (corrective fix — the
 * original v1 of this schema collapsed both into one `status` enum, including
 * `PENDING_PAYMENT` and `REFUNDED` alongside fulfilment states. A COD order must
 * progress through fulfilment while unpaid, and a transfer order must be
 * payable before it is confirmed; one enum cannot represent both without an
 * invalid combination becoming representable. See this repo's own CLAUDE.md
 * non-negotiable #6.
 *
 * **Phase 4A.5 — two changes, both found by the pre-implementation
 * architecture review:**
 *
 * 1. `paymentMethod`/`paymentStatus`/`paymentDestination` (three flat top-level
 *    fields) are replaced by structured `payment{}` — see that field's own
 *    doc comment for the full design. The prior `paymentMethod` enum
 *    (`"COD"|"WALLET"|"CARD"`) is gone: `"CARD"` never matched what the
 *    storefront's own documented payment methods actually are (COD / wallet
 *    transfer / InstaPay transfer, no card in v1), and a fixed union has to
 *    be edited in code for every new configured method — `payment.method`
 *    is now a plain string validated against `PaymentSettings.methods[]` at
 *    the route layer (no route exists yet in this phase).
 * 2. `timeline[]` is added. It did not exist at all — confirmed absent by
 *    direct reading, and independently confirmed missing by
 *    `engines/returns/return-eligibility.ts`'s own doc comment, which named
 *    the gap it was working around. This repo's own `CLAUDE.md`
 *    non-negotiable #7 already requires it ("every state transition...
 *    appends to the order timeline with actor, timestamp and reason") — this
 *    was a real gap against an existing rule, not a new requirement.
 *    Appends go through the typed `appendOrderTimelineEntry()` helper
 *    (`order-timeline.ts`), never a raw `$push` literal — `restaurant-platform-staff`'s
 *    own `transitionOrder()` has a live field-shape mismatch in its `$push`
 *    (writes `actor`, the schema declares `actorId`; omits the
 *    schema's required `actorType` entirely) that a typed append cannot
 *    reproduce, because the compiler checks the literal against
 *    `OrderTimelineEntry` before it is ever sent to Mongo.
 */
@MongoSchema({ timestamps: true })
export class OrderSchema {
  _id!: mongoose.Types.ObjectId;

  /**
   * Sequential order number for invoices.
   * Must start correct — retrofitting a sequence is painful.
   */
  @Unique()
  @MongoField({ type: String, required: true })
  orderNumber!: string;

  /**
   * Indexed: a signed-in customer's orders are always read by it — "my
   * orders" (then sorted by `placedAt` within that customer's own small set),
   * the promotion-eligibility order count, and every order lookup scoped to
   * its owner.
   */
  @Relation(() => CustomerSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false, ref: "Customer", index: true })
  customerId?: mongoose.Types.ObjectId;

  /**
   * Guest orders have no customerId.
   */
  @MongoField({ type: String, required: false })
  guestPhone?: string;

  @MongoField({ type: String, required: false })
  guestEmail?: string;

  @MongoField({ type: String, required: false })
  guestName?: string;

  /**
   * Idempotency key — scoped by route and actor before uniqueness.
   */
  @MongoField({ type: String, required: true })
  idempotencyKey!: string;

  /**
   * Fulfilment snapshot — never a reference. What the customer was shown and
   * agreed to must not change retroactively.
   *
   * `mode` selects which of `addressSnapshot` / `pickupLocationSnapshot` is
   * populated. Both are snapshots, never `@Relation`s — a pickup location's
   * live address may change after the order that referenced it was placed.
   */
  @MongoField({
    type: new mongoose.Schema(
      {
        mode: { type: String, enum: ["DELIVERY", "PICKUP"], required: true },
        addressSnapshot: {
          type: new mongoose.Schema(
            {
              recipientName: { type: String, required: true },
              phone: { type: String, required: true },
              addressLine1: { type: String, required: true },
              addressLine2: { type: String },
              city: { type: String, required: true },
              governorate: { type: String, required: true },
              postalCode: { type: String },
            },
            { _id: false }
          ),
          required: false,
        },
        pickupLocationSnapshot: {
          type: new mongoose.Schema(
            {
              name: { type: String, required: true },
              address: { type: String, required: true },
              phone: { type: String, required: true },
            },
            { _id: false }
          ),
          required: false,
        },
        zone: { type: String, required: false },
        /** Informational reference to the `DeliveryZone` the snapshot above was resolved from at placement time — never re-read; a zone changing or being soft-deleted later must not alter this order. */
        zoneId: { type: mongoose.Schema.Types.ObjectId, required: false },
        fee: moneyField({ required: true }),
        dispatchBy: { type: Date, required: false },
        /**
         * Set on delivery orders placed under the "estimate counts from confirmation" rule: confirming the order
         * re-dates `dispatchBy`/`promisedWindow` from the confirmation instant (admin/orders/confirmation-promise.ts).
         * Absent on orders placed before the rule — their saved promise is never recalculated.
         */
        promiseFromConfirmation: { type: Boolean, required: false },
        promisedWindow: {
          type: new mongoose.Schema(
            {
              from: { type: Date, required: true },
              to: { type: Date, required: true },
            },
            { _id: false }
          ),
          required: false,
        },
      },
      { _id: false }
    ),
    required: true,
  })
  fulfilment!: {
    mode: "DELIVERY" | "PICKUP";
    addressSnapshot?: {
      recipientName: string;
      phone: string;
      addressLine1: string;
      addressLine2?: string;
      city: string;
      governorate: string;
      postalCode?: string;
    };
    pickupLocationSnapshot?: {
      name: string;
      address: string;
      phone: string;
    };
    zone?: string;
    zoneId?: mongoose.Types.ObjectId;
    fee: Money;
    dispatchBy?: Date;
    promiseFromConfirmation?: boolean;
    promisedWindow?: { from: Date; to: Date };
  };

  @MongoField(moneyField({ required: true }))
  subtotal!: Money;

  @MongoField(moneyField({ defaultZero: true }))
  discount!: Money;

  @MongoField(moneyField({ defaultZero: true }))
  tax!: Money;

  @MongoField(moneyField({ required: true }))
  total!: Money;

  /**
   * Running total of every refund recorded against this order — the payment
   * refund (`payment.refund.amount`) plus each refunded return
   * (`Return.refundAmount`). Only `reserveOrderRefund()` moves it, in the same
   * transaction as the refund record, and only while it stays within `total`:
   * the one place the "cumulative refunds never exceed what was paid"
   * invariant is enforced, and the document two concurrent refunds conflict on.
   */
  @MongoField(moneyField({ defaultZero: true }))
  refundedTotal!: Money;

  /**
   * Fulfilment axis. Never carries a payment concept — see `payment.status`.
   * `READY_FOR_PICKUP` and `COLLECTED` only apply to `fulfilment.mode === "PICKUP"`;
   * `SHIPPED`, `IN_TRANSIT` and `DELIVERED` only to `"DELIVERY"`. Enforced by
   * the order-state-machine engine, not by the schema.
   *
   * `SHIPPED` is the plan's "dispatched". `IN_TRANSIT` is an optional step after
   * it. `COLLECTED` is a pickup order's terminal state; a pickup order that was
   * completed as `DELIVERED` before `COLLECTED` existed stays valid — there is
   * no migration, and every "completed" rule treats the two alike
   * (`isCompletedStatus`).
   */
  @MongoField({
    type: String,
    enum: ["PLACED", "CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "IN_TRANSIT", "DELIVERED", "COLLECTED", "CANCELLED"],
    default: "PLACED",
  })
  status!: "PLACED" | "CONFIRMED" | "PROCESSING" | "READY_FOR_PICKUP" | "SHIPPED" | "IN_TRANSIT" | "DELIVERED" | "COLLECTED" | "CANCELLED";

  /**
   * Structured payment domain, replacing the prior flat
   * `paymentMethod`/`paymentStatus`/`paymentDestination` fields (Phase
   * 4A.5 — see class doc comment for the full rationale).
   *
   * - `method` — a plain string, not a fixed union. Validated against
   *   `PaymentSettings.methods[].method` at the route layer (no route yet).
   * - `status` — method-agnostic, not proof-specific: `AWAITING_PAYMENT` and
   *   `SUBMITTED` (renamed from `AWAITING_PROOF`/`PROOF_SUBMITTED`) cover
   *   "waiting for either a manual proof or a provider callback" and "proof
   *   uploaded OR provider webhook received, pending reconciliation" — so a
   *   future online-payment method reuses this exact lifecycle with no new
   *   states. `NOT_REQUIRED` remains COD's resting state.
   * - `destinationSnapshot` — what was configured at placement (replaces the
   *   prior free-text `paymentDestination`).
   * - `verification` — set once staff (or, later, a provider) confirms or
   *   rejects. Declared here as real schema fields, not written via an
   *   untyped `$set` onto undeclared paths — `restaurant-platform-staff`'s
   *   own refund `$set` targets `payment.refundReason`/`refundedBy`/
   *   `refundedAt`, none of which its `paymentSchema` actually declares, an
   *   unverified strict-mode risk this schema avoids by declaring `refund{}`
   *   up front.
   * - `provider` — absent for every method today (COD needs neither proof
   *   nor provider; transfer methods need a proof, not a provider). The
   *   extension point: enabling a real online-payment method later means a
   *   `PaymentSettings` row with `requiresProviderIntegration: true` plus a
   *   webhook route that populates this and calls the same
   *   `assertPaymentTransition`/`appendOrderTimelineEntry` machinery — not a
   *   redesign of `Order`, the state machine, or any route already built.
   */
  @MongoField({
    type: new mongoose.Schema(
      {
        method: { type: String, required: true },
        status: {
          type: String,
          enum: ["NOT_REQUIRED", "AWAITING_PAYMENT", "SUBMITTED", "VERIFIED", "REJECTED", "REFUNDED"],
          default: "NOT_REQUIRED",
        },
        destinationSnapshot: {
          type: new mongoose.Schema(
            { accountName: { type: String, required: false }, number: { type: String, required: false }, handle: { type: String, required: false } },
            { _id: false }
          ),
          required: false,
        },
        instructionsSnapshot: { type: localizedStringSchema(), required: false },
        verification: {
          type: new mongoose.Schema(
            {
              verifiedBy: { type: mongoose.Schema.Types.ObjectId, required: false },
              verifiedAt: { type: Date, required: false },
              rejectionReason: { type: String, required: false },
            },
            { _id: false }
          ),
          required: false,
        },
        refund: {
          type: new mongoose.Schema(
            {
              reason: { type: String, required: false },
              by: { type: mongoose.Schema.Types.ObjectId, required: false },
              at: { type: Date, required: false },
              reference: { type: String, required: false },
              amount: moneyField(),
            },
            { _id: false }
          ),
          required: false,
        },
        provider: {
          type: new mongoose.Schema({ name: { type: String, required: false }, externalReference: { type: String, required: false } }, { _id: false }),
          required: false,
        },
      },
      { _id: false }
    ),
    required: true,
  })
  payment!: {
    method: string;
    status: "NOT_REQUIRED" | "AWAITING_PAYMENT" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "REFUNDED";
    destinationSnapshot?: { accountName?: string; number?: string; handle?: string };
    /** The payment instructions as shown at placement ("transfer to X, then upload the receipt"), frozen like the destination. */
    instructionsSnapshot?: LocalizedString;
    verification?: { verifiedBy?: mongoose.Types.ObjectId; verifiedAt?: Date; rejectionReason?: string };
    refund?: { reason?: string; by?: mongoose.Types.ObjectId; at?: Date; reference?: string; amount?: Money };
    provider?: { name?: string; externalReference?: string };
  };

  /**
   * Business timeline — see the module-level `OrderTimelineEventType` doc
   * comment. Append only via `appendOrderTimelineEntry()`
   * (`order-timeline.ts`); never push a raw literal here.
   */
  @MongoField({ type: [orderTimelineEntrySchema], default: () => [] })
  timeline!: OrderTimelineEntry[];

  @MongoField({ type: Date, required: false })
  customerCancelUntil?: Date;

  /**
   * Indexed: every report and list reads orders by when they were placed —
   * the sales summary's range scan, the admin order list's default sort
   * (newest first), and the payment queue's oldest-first sort. One ascending
   * index serves both directions.
   */
  @MongoField({ type: Date, required: true, index: true })
  placedAt!: Date;

  /** The customer's note from checkout (trimmed, at most 500 characters). Absent when none was given. Never staff-written: staff reasons live on the timeline. */
  @MongoField({ type: String, required: false })
  notes?: string;

  /**
   * Carrier and tracking number, entered by staff when the order ships (or later). A SNAPSHOT: `carrierName` and
   * `url` are frozen at the moment of entry, so renaming a carrier or editing its URL template in settings never
   * changes a link a customer was already given. Absent until staff enter one. Every change after the first is
   * recorded on the timeline (`ORDER_TRACKING_UPDATED`) with who made it.
   */
  @MongoField({
    type: new mongoose.Schema(
      {
        carrierKey: { type: String, required: true },
        carrierName: { type: String, required: true },
        trackingNumber: { type: String, required: true },
        url: { type: String, required: true },
        updatedAt: { type: Date, required: true },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, required: false },
      },
      { _id: false }
    ),
    required: false,
  })
  tracking?: {
    carrierKey: string;
    carrierName: string;
    trackingNumber: string;
    url: string;
    updatedAt: Date;
    updatedBy?: mongoose.Types.ObjectId;
  };

  /**
   * Sequential invoice number (`INV-000001`), allocated INSIDE the placement transaction from its own counter
   * (`invoices/allocate-invoice-number.ts`) — a rolled-back placement returns its number, so there are no gaps from
   * failures. A cancelled order KEEPS its number (the invoice is shown as void, never renumbered or reused).
   * Absent on orders placed before invoices existed; those have no invoice and are not backfilled.
   */
  @Unique({ sparse: true })
  @MongoField({ type: String, required: false })
  invoiceNumber?: string;

  /**
   * What the invoice needs that the order did not otherwise freeze: who sold it (the store profile as it was at
   * placement) and how tax was applied (the store's tax mode is configuration and may change later). The invoice
   * is built entirely from the order, its lines and this — never from today's store profile.
   */
  @MongoField({
    type: new mongoose.Schema(
      {
        issuedAt: { type: Date, required: true },
        seller: {
          type: new mongoose.Schema(
            {
              name: { type: localizedStringSchema(), required: true },
              phone: { type: String, required: false },
              email: { type: String, required: false },
            },
            { _id: false }
          ),
          required: false,
        },
        tax: {
          type: new mongoose.Schema({ mode: { type: String, enum: ["INCLUDED", "ADDED"], required: true }, rate: { type: Number, required: true } }, { _id: false }),
          required: true,
        },
      },
      { _id: false }
    ),
    required: false,
  })
  invoiceSnapshot?: {
    issuedAt: Date;
    seller?: { name: LocalizedString; phone?: string; email?: string };
    tax: { mode: "INCLUDED" | "ADDED"; rate: number };
  };

  /**
   * D-13: the version of the `terms` page the customer accepted at checkout,
   * and when. The version's text is kept in `PageRevision`, so this number
   * stays readable after the terms are edited. Optional only because orders
   * placed before D-13 carry neither; placement now always sets both.
   */
  @MongoField({ type: Number, required: false })
  termsVersionAccepted?: number;

  @MongoField({ type: Date, required: false })
  acceptedAt?: Date;

  /**
   * The promotion this order was given, frozen at placement (approved 2026-10-22,
   * docs/store/phases/07-promotion-identity-proposal.md). `promotionId` is the
   * stable identity per-customer usage is counted by, so renaming or removing a
   * code cannot reset anyone's limit, and automatic promotions (no code) can be
   * counted at all. The rest is what the customer was shown, so editing the
   * promotion later never changes this order.
   *
   * Optional, additive, and never backfilled: orders placed before it carry no
   * snapshot and are still counted by the code on their lines
   * (`OrderLineSchema.promotionCode`, see derive-promotion-context.ts). No new
   * index — the count reads one customer's orders through the `customerId` index.
   */
  @MongoField({
    type: new mongoose.Schema(
      {
        promotionId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Promotion" },
        code: { type: String, required: false },
        automatic: { type: Boolean, required: true },
        name: { type: localizedStringSchema(), required: true },
        type: { type: String, enum: ["PERCENT", "FIXED", "FREE_SHIPPING"], required: true },
        value: moneyField({ required: false }),
      },
      { _id: false }
    ),
    required: false,
  })
  appliedPromotion?: {
    promotionId: mongoose.Types.ObjectId;
    code?: string;
    automatic: boolean;
    name: LocalizedString;
    type: "PERCENT" | "FIXED" | "FREE_SHIPPING";
    value?: Money;
  };
}

// Forward declaration
class CustomerSchema {
  _id!: mongoose.Types.ObjectId;
}

export const OrderModel = createMongoModel("Order", OrderSchema);

/**
 * Order line — snapshots everything, including SKU.
 *
 * Per Phase 2 invariant: a receipt and every return flow need to know exactly
 * which variant was bought. Renaming a product or changing a price must never
 * alter a historical order.
 */
@MongoSchema({ timestamps: true })
export class OrderLineSchema {
  _id!: mongoose.Types.ObjectId;

  @Relation(() => OrderSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Order" })
  orderId!: mongoose.Types.ObjectId;

  @MongoField({ type: Number, required: true })
  lineNumber!: number;

  /**
   * Variant reference for current data (stock returns, re-order).
   */
  @Relation(() => VariantSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Variant" })
  variantId!: mongoose.Types.ObjectId;

  /**
   * The product this line was bought from — snapshotted at placement, as
   * 04-cross-repo-architecture §6 requires ("product and variant ids"). A
   * review and a "buy again" name the product, not the variant. Optional only
   * because lines placed before 2026-10-20 lack it; readers fall back to the
   * variant's product for those.
   */
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false, ref: "Product" })
  productId?: mongoose.Types.ObjectId;

  /**
   * SKU snapshot — the restaurant's order line has no SKU field anywhere.
   * For a store that is a defect.
   */
  @MongoField({ type: String, required: true })
  sku!: string;

  @MongoField({ type: String, required: true })
  productName!: string;

  @MongoField({ type: String, required: true })
  variantDescription!: string;

  @MongoField({ type: Number, required: true, min: 1 })
  quantity!: number;

  @MongoField(moneyField({ required: true }))
  unitPrice!: Money;

  @MongoField(moneyField({ required: true }))
  lineTotal!: Money;

  /**
   * The variant's cost price at the moment of sale — absent when none was set. Margin reporting (v2) reads
   * this, never the variant's current cost: a cost changed later must not rewrite the margin of a past sale,
   * and a sale placed without the snapshot can never recover it.
   */
  @MongoField(moneyField())
  unitCost?: Money;

  /**
   * Applied promotion snapshot.
   */
  @MongoField({ type: String, required: false })
  promotionCode?: string;

  @MongoField(moneyField({ defaultZero: true }))
  lineDiscount!: Money;
}

// Forward declaration
class VariantSchema {
  _id!: mongoose.Types.ObjectId;
}

export const OrderLineModel = createMongoModel("OrderLine", OrderLineSchema);
