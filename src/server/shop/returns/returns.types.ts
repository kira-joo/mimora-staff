import type { Money } from "@kira-joo/toolkit-common";

type ReturnStatusView = "REQUESTED" | "APPROVED" | "REJECTED" | "REFUNDED";

/** One returned line, enriched with the order line's own product/SKU snapshot — `ReturnLineSchema` itself stores only the return-specific fields. */
export interface ReturnLineView {
  orderLineId: string;
  sku: string;
  productName: string;
  variantDescription: string;
  quantity: number;
  reason: string;
  condition: string;
  disposition?: "RESTOCK" | "DISCARD";
}

/** Response shape for `POST /api/shop/returns` and one row of `GET /api/shop/returns`. */
export interface ReturnListItemView {
  returnId: string;
  returnNumber: string;
  orderNumber: string;
  status: ReturnStatusView;
  reason: string;
  requestedAt: Date;
  lineCount: number;
}

/** Full detail for `GET /api/shop/returns/[id]`. Staff-only fields (`processedBy`, `refundReference`) are never exposed. */
export interface ReturnDetailView {
  returnId: string;
  returnNumber: string;
  orderNumber: string;
  status: ReturnStatusView;
  reason: string;
  requestedAt: Date;
  processedAt?: Date;
  refundAmount?: Money;
  lines: ReturnLineView[];
}
