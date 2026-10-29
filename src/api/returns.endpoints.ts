import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";

/*
 * Wire types — what /api/admin/returns actually answers over JSON: Money as a
 * decimal string, dates as ISO strings. Mirrors the server's list/detail views.
 */
export type ReturnStatus = "REQUESTED" | "APPROVED" | "RECEIVED" | "REJECTED" | "REFUNDED";
export type ReturnDisposition = "RESTOCK" | "DISCARD";

export interface ReturnListItem {
  _id: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string;
  status: ReturnStatus;
  reason: string;
  requestedAt: string;
  processedAt?: string;
}

export interface ListReturnsQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  status?: ReturnStatus;
  [key: string]: unknown;
}

export interface ReturnLine {
  returnLineId: string;
  orderLineId: string;
  variantId: string;
  sku: string;
  productName: string;
  variantDescription: string;
  quantity: number;
  reason: string;
  /** The customer's own description at request time. */
  condition: string;
  /** What staff found on inspection — recorded at receipt, beside the disposition. */
  inspectedCondition?: string;
  /** Set once the line is received; a line with a disposition cannot be received again. */
  disposition?: ReturnDisposition;
}

export interface ReturnDetail {
  _id: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string;
  customerId?: string;
  status: ReturnStatus;
  reason: string;
  requestedAt: string;
  processedAt?: string;
  processedBy?: string;
  refundReference?: string;
  refundAmount?: string;
  notes?: string;
  lines: ReturnLine[];
}

const ADMIN = "/admin";

export const listReturnsEndpoint: Endpoint<{ query: ListReturnsQuery; returnType: PaginatedResponse<ReturnListItem> }> = {
  url: `${ADMIN}/returns`,
  methodType: MethodType.GET,
};

export const getReturnEndpoint: Endpoint<{ params: { id: string }; returnType: ReturnDetail }> = {
  url: `${ADMIN}/returns/:id`,
  methodType: MethodType.GET,
};

export const approveReturnEndpoint: Endpoint<{ params: { id: string }; returnType: unknown }> = {
  url: `${ADMIN}/returns/:id/approve`,
  methodType: MethodType.PUT,
};

export const rejectReturnEndpoint: Endpoint<{ params: { id: string }; body: { reason: string }; returnType: unknown }> = {
  url: `${ADMIN}/returns/:id/reject`,
  methodType: MethodType.PUT,
};

export const receiveReturnEndpoint: Endpoint<{
  params: { id: string };
  body: { lines: { returnLineId: string; disposition: ReturnDisposition; inspectedCondition: string }[] };
  returnType: unknown;
}> = {
  url: `${ADMIN}/returns/:id/receive`,
  methodType: MethodType.PUT,
};

export const refundReturnEndpoint: Endpoint<{
  params: { id: string };
  body: { refundReference: string; amount: string };
  returnType: unknown;
}> = {
  url: `${ADMIN}/returns/:id/refund`,
  methodType: MethodType.PUT,
};
