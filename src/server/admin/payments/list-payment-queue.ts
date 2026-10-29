import { SortOrder } from "@kira-joo/toolkit-common";
import type { Money, PaginatedResponse } from "@kira-joo/toolkit-common";
import { orderRepository, paymentProofRepository, paymentSettingsRepository } from "../../core/repositories";
import { isVerificationOverdue } from "../../engines/order-state/unpaid-expiry";
import { privateAssets } from "../../core/assets/asset-providers";
import { PAYMENT_PROOF_SIGNED_URL_TTL_SECONDS } from "../../core/assets/upload-policies";
import type { ListPaymentQueueQueryDto } from "../dto/list-payment-queue-query.dto";

/** Signed URLs are short-lived and minted per request — never stored. */

export interface PaymentQueueItemView {
  orderId: string;
  orderNumber: string;
  placedAt: Date;
  method: string;
  expectedAmount: Money;
  destinationSnapshot?: { accountName?: string; number?: string; handle?: string };
  proof?: { proofId: string; submittedAt: Date; signedUrl: string };
  /**
   * The proof has waited longer than this method's `verificationWindowMinutes` for a decision. A flag for triage and
   * nothing more: no order is cancelled, rejected or verified because of it — staff decide.
   */
  overdue: boolean;
  /** The configured window, so the console can say what "overdue" means. Absent when the method has none. */
  verificationWindowMinutes?: number;
}

/**
 * Payments queue per MDS §6.4 — Wallet/InstaPay transfers awaiting manual
 * verification: `Order.payment.status === "SUBMITTED"`. The proof's signed
 * URL is minted here, inside this same permission-checked handler's own
 * service call, and never persisted — an unguessable stored URL is
 * obscurity, not access control (this repo's own "moving an asset must not
 * change who can read it" rule).
 */
export async function listPaymentQueue(query: ListPaymentQueueQueryDto, now: Date = new Date()): Promise<PaginatedResponse<PaymentQueueItemView>> {
  const settings = await paymentSettingsRepository.findOne({ where: {}, skipThrowError: true });
  const windowByMethod = new Map((settings?.methods ?? []).map((method) => [method.method, method.verificationWindowMinutes]));

  const where = { "payment.status": "SUBMITTED" as const };

  const result = await orderRepository.findAllAndCountPublic({
    where,
    sort: { field: "placedAt", order: SortOrder.ASC },
    query,
  });

  const orderIds = result.data.map((order) => order._id);
  const proofs = await paymentProofRepository.findAll({
    where: { orderId: { $in: orderIds }, status: "SUBMITTED" },
    sort: { field: "submittedAt", order: SortOrder.DESC },
  });
  // Multiple SUBMITTED rows for one order shouldn't exist per the payment
  // state machine (a second submission only happens after a REJECTED, which
  // this filter excludes) — keeping the most recent per order is defensive.
  const latestProofByOrder = new Map<string, (typeof proofs)[number]>();
  for (const proof of proofs) {
    const key = proof.orderId.toString();
    if (!latestProofByOrder.has(key)) latestProofByOrder.set(key, proof);
  }

  // Storage is only needed to sign a receipt link: a store without Cloudinary can still list unpaid orders.
  const assets = latestProofByOrder.size > 0 ? privateAssets() : undefined;

  return {
    ...result,
    data: result.data.map((order) => {
      const proof = latestProofByOrder.get(order._id.toString());
      const verificationWindowMinutes = windowByMethod.get(order.payment.method);
      return {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        placedAt: order.placedAt,
        method: order.payment.method,
        expectedAmount: order.total,
        destinationSnapshot: order.payment.destinationSnapshot,
        overdue: proof ? isVerificationOverdue({ submittedAt: proof.submittedAt, now, verificationWindowMinutes }) : false,
        verificationWindowMinutes,
        proof: proof
          ? {
              proofId: proof._id.toString(),
              submittedAt: proof.submittedAt,
              signedUrl: assets!.signedUrl({ publicId: proof.asset.publicId, format: proof.asset.format }, PAYMENT_PROOF_SIGNED_URL_TTL_SECONDS),
            }
          : undefined,
      };
    }),
  };
}
