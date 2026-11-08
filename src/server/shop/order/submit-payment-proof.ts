import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { ParsedMultipartFile } from "@kira-joo/backend-toolkit-next";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { appendOrderTimelineEntry } from "../../commerce/order-timeline";
import { orderRepository, paymentProofRepository, paymentSettingsRepository } from "../../core/repositories";
import { assertPaymentTransition, canTransitionPayment, timelineEventForPaymentStatus } from "../../engines/order-state/order-state-machine";
import { privateAssets } from "../../core/assets/asset-providers";
import { CLOUDINARY_ROOT } from "../../admin/media/media-targets";
import { orderOwnerFilter, type OrderOwner } from "./order-access";
import type { PaymentProofSubmissionView } from "./order.types";

export type SubmitPaymentProofInput = OrderOwner & {
  orderNumber: string;
  file: ParsedMultipartFile;
  now: Date;
};

/**
 * Submits payment proof for `POST /api/shop/orders/[orderNumber]/payment-proof`.
 *
 * Validates, in order:
 * - Order exists and belongs to this owner (a customer, or a guest holding the order's access token)
 * - The order's payment method is configured, enabled, and `requiresProof`
 *   in `PaymentSettings` — a customer cannot submit proof for a method that
 *   doesn't need one, and a method that no longer exists/is disabled is
 *   treated as unavailable (mirrors `place-order.ts`'s own check).
 * - The current payment status allows a transition to `SUBMITTED`
 *   (`AWAITING_PAYMENT` or `REJECTED` — `order-state-machine`'s own map)
 *
 * **The Cloudinary upload happens before the transaction opens** — this
 * repo's own non-negotiable: no external I/O inside `withTransaction`. If
 * the transaction subsequently aborts, `tx.onAbort` destroys the
 * newly-uploaded asset so a failed submission never leaves an orphaned
 * private file.
 *
 * Transactionally:
 * - Creates a new `PaymentProof` row (submission HISTORY — see that
 *   schema's own doc comment on why a rejected proof is a kept row, never
 *   overwritten)
 * - Transitions `Order.payment.status` to `SUBMITTED`
 * - Appends the `PAYMENT_SUBMITTED` timeline event
 *
 * The repositories pick up the ambient transaction session themselves.
 */
export async function submitPaymentProof(input: SubmitPaymentProofInput): Promise<PaymentProofSubmissionView> {
  const { customer, orderNumber, file, now } = input;

  const order = await orderRepository.findOne({ where: orderOwnerFilter(input, orderNumber), skipThrowError: true });
  if (!order) {
    throw new NotFoundError("Order not found.");
  }

  const paymentSettings = await paymentSettingsRepository.findOne({ where: {}, skipThrowError: true });
  const paymentMethodConfig = paymentSettings?.methods.find(
    (method) => method.method === order.payment.method && method.enabled
  );
  if (!paymentMethodConfig) {
    throw new NotFoundError(`Payment method "${order.payment.method}" is not available.`);
  }
  if (!paymentMethodConfig.requiresProof) {
    throw new ConflictError(`Payment method "${order.payment.method}" does not require a proof.`);
  }

  if (!canTransitionPayment(order.payment.status, "SUBMITTED")) {
    throw new ConflictError(`Payment cannot move from ${order.payment.status} to SUBMITTED.`);
  }

  // External I/O before the transaction — see this function's own doc comment.
  const uploaded = await privateAssets().upload(file.buffer, { folder: `${CLOUDINARY_ROOT}/payment-proofs/orders/${order.orderNumber}` });

  return withTransaction(async (tx) => {
    tx.onAbort(async () => {
      await privateAssets().destroy(uploaded.publicId);
    });

    const proof = await paymentProofRepository.save({
      orderId: order._id,
      submittedAt: now,
      asset: {
        publicId: uploaded.publicId,
        format: uploaded.format,
        bytes: uploaded.bytes,
        mimeType: file.mimeType,
        filename: file.filename,
      },
      status: "SUBMITTED",
    });

    assertPaymentTransition(order.payment.status, "SUBMITTED");

    await orderRepository.updateAtomic({ _id: order._id }, { $set: { "payment.status": "SUBMITTED" } }, { skipThrowError: true });

    await appendOrderTimelineEntry(order._id, {
      type: timelineEventForPaymentStatus("SUBMITTED")!,
      at: now,
      actorType: "CUSTOMER",
      actorId: customer ? new mongoose.Types.ObjectId(customer._id) : undefined,
    });

    return tx.complete({
      proofId: proof._id.toString(),
      submittedAt: proof.submittedAt,
      paymentStatus: "SUBMITTED" as const,
    });
  });
}
