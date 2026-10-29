import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";

/** One payment awaiting review, as GET /admin/payments/queue answers it (wire types). */
export interface PaymentQueueItem {
  orderId: string;
  orderNumber: string;
  placedAt: string;
  method: string;
  expectedAmount: string;
  destinationSnapshot?: { accountName?: string; number?: string; handle?: string };
  /** The proof, with a short-lived signed URL (5 minutes) minted per request behind the same permission. */
  proof?: { proofId: string; submittedAt: string; signedUrl: string };
  /** Waited longer than the method's verificationWindowMinutes — a triage flag only; nothing happens automatically. */
  overdue: boolean;
  verificationWindowMinutes?: number;
}

export interface PaymentQueueQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  /** Satisfies `Endpoint`'s `Record<string, unknown>` query constraint while keeping the named fields above. */
  [key: string]: unknown;
}

const ADMIN = "/admin";

export const paymentQueueEndpoint: Endpoint<{ query: PaymentQueueQuery; returnType: PaginatedResponse<PaymentQueueItem> }> = {
  url: `${ADMIN}/payments/queue`,
  methodType: MethodType.GET,
};

export const verifyPaymentEndpoint: Endpoint<{ params: { id: string }; returnType: unknown }> = {
  url: `${ADMIN}/orders/:id/payment/verify`,
  methodType: MethodType.PUT,
};

export const rejectPaymentEndpoint: Endpoint<{ params: { id: string }; body: { reason: string }; returnType: unknown }> = {
  url: `${ADMIN}/orders/:id/payment/reject`,
  methodType: MethodType.PUT,
};

export const refundPaymentEndpoint: Endpoint<{
  params: { id: string };
  /** `reference` is mandatory (D-12). Every write here also needs an `Idempotency-Key` header. */
  body: { amount: string; reason?: string; reference: string };
  returnType: unknown;
}> = {
  url: `${ADMIN}/orders/:id/payment/refund`,
  methodType: MethodType.PUT,
};
