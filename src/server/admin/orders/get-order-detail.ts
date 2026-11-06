import { ZERO } from "@kira-joo/toolkit-common";
import { SortOrder } from "@kira-joo/toolkit-common";
import { ServiceUnavailableError } from "@kira-joo/backend-toolkit-core";
import { fulfilmentSettingsRepository, orderLineRepository, orderRepository, paymentProofRepository, staffUserRepository } from "../../core/repositories";
import { privateAssets } from "../../core/assets/asset-providers";
import { PAYMENT_PROOF_SIGNED_URL_TTL_SECONDS } from "../../core/assets/upload-policies";
import type { WithTimestamps } from "../../core/with-timestamps";

export interface OrderDetailOptions {
  /**
   * Whether the caller holds `Payment.verify` — the permission that guards receipts (a receipt is a customer's bank
   * data, and order-read is held by every fulfilment and support role). The route computes it from the signed-in
   * staff member; the default is `false`, so a caller that forgets to say gets no proof and no link.
   */
  canViewPaymentProofs?: boolean;
}

/** One submission of a payment proof, kept after it is verified or rejected. The link is minted per request and never stored. */
export interface PaymentProofView {
  proofId: string;
  status: "SUBMITTED" | "VERIFIED" | "REJECTED";
  submittedAt: Date;
  reviewedAt?: Date;
  reviewedByName?: string;
  rejectionReason?: string;
  filename: string;
  mimeType: string;
  /** Short-lived (`PAYMENT_PROOF_SIGNED_URL_TTL_SECONDS`). Absent only when private file storage is not configured. */
  signedUrl?: string;
  signedUrlUnavailable?: true;
}

/**
 * Full immutable snapshot per MDS §6.3 — lines, pricing breakdown,
 * fulfilment snapshot, payment (destination snapshot + verification/refund),
 * the complete timeline, customer/guest snapshot, notes. Nothing here is
 * re-derived from current catalog data — everything is what the order's
 * own documents already snapshot.
 */
export async function getOrderDetailAdmin(orderId: string, options: OrderDetailOptions = {}) {
  const order = await orderRepository.findOne({ where: { _id: orderId } });

  const lines = await orderLineRepository.findAll({
    where: { orderId: order._id },
    sort: { field: "lineNumber", order: SortOrder.ASC },
  });

  const proofs = options.canViewPaymentProofs
    ? await paymentProofRepository.findAll({ where: { orderId: order._id }, sort: { field: "submittedAt", order: SortOrder.DESC } })
    : undefined;

  // One lookup resolves every staff actor on the page: timeline entries and proof reviewers.
  const staffIds = new Set<string>();
  for (const entry of order.timeline) if (entry.actorType === "STAFF" && entry.actorId) staffIds.add(entry.actorId.toString());
  for (const proof of proofs ?? []) if (proof.reviewedBy) staffIds.add(proof.reviewedBy.toString());
  if (order.tracking?.updatedBy) staffIds.add(order.tracking.updatedBy.toString());
  const staff = staffIds.size > 0 ? await staffUserRepository.findAll({ where: { _id: { $in: [...staffIds] } }, select: { name: true } }) : [];
  const staffName = new Map(staff.map((member) => [member._id.toString(), member.name]));

  // Names only: the carrier picker on the ship dialog. The URL templates stay in settings (a different permission).
  const settings = await fulfilmentSettingsRepository.findOne({ where: {}, skipThrowError: true, lean: true });

  return {
    _id: order._id.toString(),
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    status: order.status,
    customerId: order.customerId?.toString(),
    guestName: order.guestName,
    guestPhone: order.guestPhone,
    guestEmail: order.guestEmail,
    lines: lines.map((line) => ({
      lineNumber: line.lineNumber,
      variantId: line.variantId.toString(),
      sku: line.sku,
      productName: line.productName,
      variantDescription: line.variantDescription,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      promotionCode: line.promotionCode,
      lineDiscount: line.lineDiscount,
    })),
    subtotal: order.subtotal,
    discount: order.discount,
    tax: order.tax,
    total: order.total,
    /** Every refund recorded so far — the payment refund plus refunded returns (`reserveOrderRefund`). */
    refundedTotal: order.refundedTotal ?? ZERO,
    fulfilment: order.fulfilment,
    payment: order.payment,
    /** Each staff entry carries the acting member's name (an account since removed has none — the id remains). */
    timeline: order.timeline.map((entry) => ({
      type: entry.type,
      at: entry.at,
      actorType: entry.actorType,
      actorId: entry.actorId?.toString(),
      actorName: entry.actorType === "STAFF" && entry.actorId ? staffName.get(entry.actorId.toString()) : undefined,
      reason: entry.reason,
      metadata: entry.metadata,
    })),
    /** Present only for a caller holding `Payment.verify`; every submission, newest first, including verified and rejected ones. */
    paymentProofs: proofs ? await toProofViews(proofs, staffName) : undefined,
    /** The customer's own checkout note. Staff never write to this field; their reasons live on the timeline. */
    notes: order.notes,
    /** Carrier + tracking number as entered by staff; `url` is the link frozen at entry. Absent until entered. */
    tracking: order.tracking
      ? {
          carrierKey: order.tracking.carrierKey,
          carrierName: order.tracking.carrierName,
          trackingNumber: order.tracking.trackingNumber,
          url: order.tracking.url,
          updatedAt: order.tracking.updatedAt,
          updatedByName: order.tracking.updatedBy ? staffName.get(order.tracking.updatedBy.toString()) : undefined,
        }
      : undefined,
    carriers: (settings?.carriers ?? []).map((carrier) => ({ key: carrier.key, name: carrier.name })),
    /** Absent on orders placed before invoices existed. */
    invoiceNumber: order.invoiceNumber,
    /** D-13 — absent on orders placed before acceptance was recorded. */
    termsVersionAccepted: order.termsVersionAccepted,
    acceptedAt: order.acceptedAt,
    createdAt: (order as WithTimestamps<typeof order>).createdAt,
    updatedAt: (order as WithTimestamps<typeof order>).updatedAt,
  };
}

async function toProofViews(
  proofs: Awaited<ReturnType<typeof paymentProofRepository.findAll>>,
  staffName: Map<string, string>
): Promise<PaymentProofView[]> {
  let assets: ReturnType<typeof privateAssets> | undefined;
  if (proofs.length > 0) {
    try {
      assets = privateAssets();
    } catch (error) {
      // Storage not configured must not take the whole order page down — the proof rows still show, flagged.
      if (!(error instanceof ServiceUnavailableError)) throw error;
    }
  }

  return proofs.map((proof) => ({
    proofId: proof._id.toString(),
    status: proof.status,
    submittedAt: proof.submittedAt,
    reviewedAt: proof.reviewedAt,
    reviewedByName: proof.reviewedBy ? staffName.get(proof.reviewedBy.toString()) : undefined,
    rejectionReason: proof.rejectionReason,
    filename: proof.asset.filename,
    mimeType: proof.asset.mimeType,
    ...(assets
      ? { signedUrl: assets.signedUrl({ publicId: proof.asset.publicId, format: proof.asset.format }, PAYMENT_PROOF_SIGNED_URL_TTL_SECONDS) }
      : { signedUrlUnavailable: true as const }),
  }));
}
