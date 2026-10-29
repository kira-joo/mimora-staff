import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";

/*
 * Wire types — what /api/admin/orders actually answers over JSON: Money as a
 * decimal string, dates as ISO strings. Never the server's Decimal/Date types.
 */
/**
 * `SHIPPED` is the plan's "dispatched"; `IN_TRANSIT` is an optional step after it. A pickup order ends in
 * `COLLECTED`; one completed as `DELIVERED` before `COLLECTED` existed stays valid.
 */
export type OrderStatus = "PLACED" | "CONFIRMED" | "PROCESSING" | "READY_FOR_PICKUP" | "SHIPPED" | "IN_TRANSIT" | "DELIVERED" | "COLLECTED" | "CANCELLED";
export type PaymentStatus = "NOT_REQUIRED" | "AWAITING_PAYMENT" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "REFUNDED";
export type FulfilmentMode = "DELIVERY" | "PICKUP";

export interface OrderListItem {
  _id: string;
  orderNumber: string;
  placedAt: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  mode: FulfilmentMode;
  zone?: string;
  customerId?: string;
  guestName?: string;
  /** Guest name, else the account's, else the delivery recipient. */
  customerName?: string;
  total: string;
  itemCount: number;
}

export interface ListOrdersQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  mode?: FulfilmentMode;
  /** Satisfies `Endpoint`'s `Record<string, unknown>` query constraint while keeping the named fields above. */
  [key: string]: unknown;
}

export interface OrderLine {
  lineNumber: number;
  variantId: string;
  sku: string;
  /** Snapshotted at purchase in the shopper's language — a single string, not a localized pair. */
  productName: string;
  variantDescription: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  promotionCode?: string;
  lineDiscount?: string;
}

export interface OrderTimelineEntry {
  type: string;
  at: string;
  actorType: "STAFF" | "CUSTOMER" | "SYSTEM";
  actorId?: string;
  /** The staff member's name, resolved server-side from `actorId` — absent for non-staff actors and for a removed account. */
  actorName?: string;
  reason?: string;
}

/** One payment-proof submission. Only sent to a caller holding Payment.verify, and kept after it is verified or rejected. */
export interface OrderPaymentProof {
  proofId: string;
  status: "SUBMITTED" | "VERIFIED" | "REJECTED";
  submittedAt: string;
  reviewedAt?: string;
  reviewedByName?: string;
  rejectionReason?: string;
  filename: string;
  mimeType: string;
  /** Minted per request and short-lived (5 minutes) — never cached or stored. */
  signedUrl?: string;
  /** Private file storage is not configured, so no link could be minted. */
  signedUrlUnavailable?: true;
}

export interface OrderTracking {
  carrierKey: string;
  carrierName: string;
  trackingNumber: string;
  url: string;
  updatedAt: string;
  updatedByName?: string;
}

export interface OrderDetail {
  _id: string;
  orderNumber: string;
  placedAt: string;
  status: OrderStatus;
  customerId?: string;
  guestName?: string;
  guestPhone?: string;
  guestEmail?: string;
  lines: OrderLine[];
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  /** Every refund recorded on the order so far: the payment refund plus refunded returns. */
  refundedTotal: string;
  fulfilment: {
    mode: FulfilmentMode;
    fee: string;
    zone?: string;
    dispatchBy?: string;
    addressSnapshot?: { recipientName: string; phone: string; addressLine1: string; addressLine2?: string; city: string; governorate: string; postalCode?: string };
    pickupLocationSnapshot?: { name: string; address: string; phone: string };
  };
  payment: {
    method: string;
    status: PaymentStatus;
    destinationSnapshot?: { accountName?: string; number?: string; handle?: string };
    refund?: { amount?: string; at?: string; reference?: string; reason?: string };
  };
  timeline: OrderTimelineEntry[];
  /** Absent unless the caller holds Payment.verify. Newest first. */
  paymentProofs?: OrderPaymentProof[];
  /** The customer's own note from checkout — never written by staff. */
  notes?: string;
  /** Carrier and tracking number; `url` is the link frozen when staff entered it. */
  tracking?: OrderTracking;
  /** The carriers staff can choose when shipping (names only; the URL templates are settings). */
  carriers: Array<{ key: string; name: string }>;
  /** Absent on orders placed before invoices existed. */
  invoiceNumber?: string;
  /** D-13: the terms version the customer accepted at checkout, and when. Absent on orders placed before it was recorded. */
  termsVersionAccepted?: number;
  acceptedAt?: string;
}

const ADMIN = "/admin";

export const listOrdersEndpoint: Endpoint<{ query: ListOrdersQuery; returnType: PaginatedResponse<OrderListItem> }> = {
  url: `${ADMIN}/orders`,
  methodType: MethodType.GET,
};

export const getOrderEndpoint: Endpoint<{ params: { id: string }; returnType: OrderDetail }> = {
  url: `${ADMIN}/orders/:id`,
  methodType: MethodType.GET,
};

/** What one unpaid-order sweep did (POST /admin/orders/expire-unpaid). */
export interface ExpireUnpaidOrdersResult {
  cancelled: string[];
  skipped: number;
  failed: Array<{ orderNumber: string; message: string }>;
  /** Payment methods that have an autoCancelMinutes configured; empty means the sweep is off for every method. */
  methodsSwept: string[];
}

export const expireUnpaidOrdersEndpoint: Endpoint<{ returnType: ExpireUnpaidOrdersResult }> = {
  url: `${ADMIN}/orders/expire-unpaid`,
  methodType: MethodType.POST,
};

export const transitionOrderEndpoint: Endpoint<{
  params: { id: string };
  /** `carrierKey` and `trackingNumber` only with `SHIPPED`, both or neither. */
  body: { status: Exclude<OrderStatus, "PLACED">; reason?: string; carrierKey?: string; trackingNumber?: string };
  returnType: unknown;
}> = {
  url: `${ADMIN}/orders/:id/status`,
  methodType: MethodType.PUT,
};

export const updateOrderTrackingEndpoint: Endpoint<{ params: { id: string }; body: { carrierKey: string; trackingNumber: string }; returnType: unknown }> = {
  url: `${ADMIN}/orders/:id/tracking`,
  methodType: MethodType.PUT,
};

export interface BoardCard {
  _id: string;
  orderNumber: string;
  placedAt: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  mode: FulfilmentMode;
  zone?: string;
  customerName?: string;
  total: string;
  itemCount: number;
  dispatchBy?: string;
}

export interface BoardColumn {
  status: OrderStatus;
  /** Every order in this status matching the filters — more than `orders.length` once the column is capped. */
  total: number;
  orders: BoardCard[];
}

export const getOrdersBoardEndpoint: Endpoint<{ query: { mode?: FulfilmentMode; search?: string; [key: string]: unknown }; returnType: { columns: BoardColumn[] } }> = {
  url: `${ADMIN}/orders/board`,
  methodType: MethodType.GET,
};

/** `GET /orders/:id/invoice` — built from the order's own snapshots; money as decimal strings. */
export interface InvoiceDocument {
  invoiceNumber: string;
  orderNumber: string;
  issuedAt: string;
  placedAt: string;
  status: "ISSUED" | "VOID";
  voidedAt?: string;
  seller?: { name: { en?: string; ar?: string }; phone?: string; email?: string };
  billTo: { name?: string; phone?: string; email?: string };
  fulfilment: {
    mode: FulfilmentMode;
    zone?: string;
    address?: { recipientName: string; phone: string; addressLine1: string; addressLine2?: string; city: string; governorate: string; postalCode?: string };
    pickupLocation?: { name: string; address: string; phone: string };
  };
  lines: Array<{ lineNumber: number; sku: string; productName: string; variantDescription: string; quantity: number; unitPrice: string; discount: string; lineTotal: string }>;
  subtotal: string;
  discount: string;
  promotionCode?: string;
  shipping: string;
  tax: { mode: "INCLUDED" | "ADDED"; rate: number; amount: string };
  total: string;
  payment: { method: string; status: PaymentStatus };
  refunds: { total: string; entries: Array<{ kind: "PAYMENT" | "RETURN"; amount: string; at?: string; reference?: string; returnNumber?: string }> };
}

export const getInvoiceEndpoint: Endpoint<{ params: { id: string }; returnType: InvoiceDocument }> = {
  url: `${ADMIN}/orders/:id/invoice`,
  methodType: MethodType.GET,
};

/** `GET /orders/:id/packing-slip` — lines, ship-to or pickup, notes. No money. */
export interface PackingSlipDocument {
  orderNumber: string;
  placedAt: string;
  status: OrderStatus;
  mode: FulfilmentMode;
  shipTo?: { recipientName: string; phone: string; addressLine1: string; addressLine2?: string; city: string; governorate: string; postalCode?: string; zone?: string };
  pickup?: { name: string; address: string; phone: string };
  contact: { name?: string; phone?: string };
  dispatchBy?: string;
  promisedWindow?: { from: string; to: string };
  paymentMethod: string;
  lines: Array<{ lineNumber: number; sku: string; productName: string; variantDescription: string; quantity: number }>;
  totalUnits: number;
  notes?: string;
}

export const getPackingSlipEndpoint: Endpoint<{ params: { id: string }; returnType: PackingSlipDocument }> = {
  url: `${ADMIN}/orders/:id/packing-slip`,
  methodType: MethodType.GET,
};

/** `GET /orders/picking-list?ids=…` — one entry per SKU across the selected orders. */
export interface PickingListDocument {
  orderCount: number;
  totalUnits: number;
  items: Array<{ sku: string; productName: string; variantDescription: string; quantity: number; orders: Array<{ orderNumber: string; quantity: number }> }>;
  orders: Array<{ orderNumber: string; mode: FulfilmentMode; units: number }>;
  skipped: Array<{ orderNumber: string; reason: "CANCELLED" }>;
  missing: string[];
}

export const getPickingListEndpoint: Endpoint<{ query: { ids: string }; returnType: PickingListDocument }> = {
  url: `${ADMIN}/orders/picking-list`,
  methodType: MethodType.GET,
};
