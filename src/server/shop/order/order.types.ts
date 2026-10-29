import type { LocalizedString, Money } from "@kira-joo/toolkit-common";
import type { OrderStatus } from "../../engines/order-state/order-state.types";

/**
 * Response shape for `POST /api/shop/orders` — customer's view of the placed
 * order, per MDS §11.2.
 *
 * Mirrors `PlacedOrderResult` from the engine but adds customer-facing fields
 * like `promisedWindow` from fulfilment resolution.
 */
export interface PlaceOrderView {
  orderId: string;
  orderNumber: string;
  subtotal: Money;
  discount: Money;
  tax: Money;
  total: Money;
  status: OrderStatus;
  paymentStatus: "NOT_REQUIRED" | "AWAITING_PAYMENT" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "REFUNDED";
  promisedWindow?: { from: Date; to: Date };
  /** Guest orders only — the capability to view, cancel and pay this order (`x-order-access-token`). Never present for a customer order. */
  accessToken?: string;
}

/**
 * Single item in `GET /api/shop/orders` list — minimal fields for order
 * history browsing.
 */
export interface OrderListItemView {
  orderId: string;
  orderNumber: string;
  placedAt: Date;
  status: OrderStatus;
  paymentStatus: "NOT_REQUIRED" | "AWAITING_PAYMENT" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "REFUNDED";
  total: Money;
  itemCount: number;
}

/**
 * Order line for detail view — includes product/variant snapshot plus pricing.
 */
export interface OrderLineView {
  /** The order line's own id — what `POST /api/shop/returns` names per line. */
  orderLineId: string;
  lineNumber: number;
  variantId: string;
  /** The product bought — what `POST /api/shop/reviews` names. */
  productId: string | null;
  sku: string;
  productName: string;
  variantDescription: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
}

/**
 * Full order detail for `GET /api/shop/orders/[orderNumber]` — everything the
 * customer needs to track their order.
 */
export interface OrderDetailView {
  orderId: string;
  orderNumber: string;
  placedAt: Date;
  status: OrderStatus;
  paymentStatus: "NOT_REQUIRED" | "AWAITING_PAYMENT" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "REFUNDED";
  lines: OrderLineView[];
  subtotal: Money;
  discount: Money;
  tax: Money;
  total: Money;
  fulfilment: {
    mode: "DELIVERY" | "PICKUP";
    fee: Money;
    zone?: string;
    dispatchBy?: Date;
    promisedWindow?: { from: Date; to: Date };
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
  };
  payment: OrderPaymentView;
  /** The customer's own checkout note, echoed back. Absent when none was given. */
  notes?: string;
  /** Carrier and tracking number staff entered. `url` is the link frozen when they did — render it only as a link to an `https` page. Absent until the order ships with tracking. */
  tracking?: { carrierName: string; trackingNumber: string; url: string };
  /** Present when this order has an invoice (`GET .../invoice`); orders placed before invoices existed have none. */
  invoiceNumber?: string;
  /** Customer-safe, chronological: `{ type, at }` only — no actor, reason or internal event. */
  timeline: OrderTimelineView;
  canCancel: boolean;
}

export type OrderTimelineView = Array<{
  type:
    | "ORDER_PLACED"
    | "ORDER_CONFIRMED"
    | "ORDER_PROCESSING"
    | "ORDER_READY_FOR_PICKUP"
    | "ORDER_SHIPPED"
    | "ORDER_IN_TRANSIT"
    | "ORDER_DELIVERED"
    | "ORDER_COLLECTED"
    | "ORDER_CANCELLED"
    | "PAYMENT_SUBMITTED"
    | "PAYMENT_VERIFIED"
    | "PAYMENT_REJECTED"
    | "PAYMENT_REFUNDED";
  at: Date;
}>;

export interface OrderPaymentView {
  method: string;
  status: "NOT_REQUIRED" | "AWAITING_PAYMENT" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "REFUNDED";
  /** Only while `status` is REJECTED — the staff reason, verbatim. */
  rejectionReason?: string;
  /** Where to pay, as frozen at placement — only while the customer still has something to pay or prove. */
  destination?: { accountName?: string; number?: string; handle?: string };
  /** How to pay, as frozen at placement, in both locales. */
  instructions?: LocalizedString;
}

/**
 * Response shape for `POST /api/shop/orders/[orderNumber]/payment-proof` —
 * confirms the submission and the order's new payment status. The proof
 * asset itself is never echoed back (no URL exists to hand back — see
 * `PaymentProofSchema`'s own doc comment); retrieval is a separate,
 * signed-URL-minting route, out of scope for this batch.
 */
export interface PaymentProofSubmissionView {
  proofId: string;
  submittedAt: Date;
  paymentStatus: "NOT_REQUIRED" | "AWAITING_PAYMENT" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "REFUNDED";
}
