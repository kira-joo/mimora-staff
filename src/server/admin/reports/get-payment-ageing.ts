import { orderRepository, paymentProofRepository } from "../../core/repositories";
import { agePaymentQueue, type PaymentAgeingReport } from "../../engines/reports/payment-ageing";

/**
 * MDS §15a payment verification queue, with ageing: every transfer awaiting
 * review and how long it has waited. "The ageing is the point, not the
 * count."
 *
 * The whole queue, unpaginated — the band counts and the oldest wait are
 * only true over all of it, and it is a work queue that verification keeps
 * short. A payment waits from the moment its proof was submitted; an order
 * marked SUBMITTED without a proof row (which the payment state machine
 * should not produce) falls back to its placement time rather than vanishing.
 *
 * Proof images are not included — that is the action screen's job
 * (`/api/admin/payments/queue`), which signs them per request.
 */
export async function getPaymentAgeing(now: Date): Promise<PaymentAgeingReport> {
  const orders = await orderRepository.findAll({ where: { "payment.status": "SUBMITTED" } });
  const proofs = await paymentProofRepository.findAll({
    where: { orderId: { $in: orders.map((order) => order._id) }, status: "SUBMITTED" },
  });

  const submittedAtByOrder = new Map<string, Date>();
  for (const proof of proofs) {
    const key = proof.orderId.toString();
    const existing = submittedAtByOrder.get(key);
    if (!existing || proof.submittedAt > existing) submittedAtByOrder.set(key, proof.submittedAt);
  }

  return agePaymentQueue(
    orders.map((order) => ({
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      method: order.payment.method,
      expectedAmount: order.total,
      waitingSince: submittedAtByOrder.get(order._id.toString()) ?? order.placedAt,
    })),
    now
  );
}
