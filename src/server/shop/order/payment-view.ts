import type { LocalizedString } from "@kira-joo/toolkit-common";
import type { OrderSchema } from "../../commerce/order.schema";
import type { OrderPaymentView } from "./order.types";

/** Statuses in which the customer still has something to do about the payment — only then are the destination and instructions shown. */
const PAYABLE_STATUSES: ReadonlySet<OrderSchema["payment"]["status"]> = new Set(["AWAITING_PAYMENT", "SUBMITTED", "REJECTED"]);

/**
 * The customer-facing payment block of an order. `rejectionReason` is present
 * only while the payment sits in REJECTED (MDS §13: a rejected proof reopens
 * submission with the staff's reason shown); `destination`/`instructions` are
 * the values frozen on the order at placement, so the payment screen can say
 * "pay X to Y" even after the merchant edits their settings.
 */
export function buildPaymentView(payment: OrderSchema["payment"]): OrderPaymentView {
  const view: OrderPaymentView = { method: payment.method, status: payment.status };

  if (payment.status === "REJECTED" && payment.verification?.rejectionReason) {
    view.rejectionReason = payment.verification.rejectionReason;
  }
  if (PAYABLE_STATUSES.has(payment.status)) {
    if (payment.destinationSnapshot) view.destination = payment.destinationSnapshot;
    if (payment.instructionsSnapshot) view.instructions = payment.instructionsSnapshot as LocalizedString;
  }
  return view;
}
