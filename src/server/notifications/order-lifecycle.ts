import type mongoose from "mongoose";
import { SortOrder, moneyView, type Money } from "@kira-joo/toolkit-common";
import { AppRoute } from "../../common/routes/app-route";
import type { OrderTimelineEntry } from "../commerce/order.schema";
import { customerRepository, notificationSettingsRepository, orderRepository, returnRepository } from "../core/repositories";
import { loadMailContext } from "../core/mail/mail-context";
import { sendTemplatedEmail } from "../core/mail/send-email";
import { orderEmail, type OrderEmailInput } from "../core/mail/templates/order-emails";
import { isEmailEnabledFor, orderEmailKindForEvent } from "../engines/notifications/order-email-policy";
import { staffNotificationTypeForEvent } from "../engines/notifications/staff-notification-policy";
import { afterCommit } from "./after-commit";
import { runAfterResponse } from "./after-response";
import { saveStaffNotification } from "./notify-staff";

/** The parts of a timeline entry the notifications read. */
export type LifecycleEvent = Pick<OrderTimelineEntry, "type"> & Partial<Pick<OrderTimelineEntry, "reason" | "metadata">>;

/**
 * Everything an order lifecycle event sets in motion outside the database: the
 * customer's email and the staff notification. Called by
 * `appendOrderTimelineEntry` (the one writer of `Order.timeline`) and, for the
 * placement event — which placement writes as part of creating the order — by
 * the shop's place-order use case.
 *
 * Runs after commit (`afterCommit`), so a rolled-back transition emails nobody,
 * and each half is isolated: a failed email never costs the staff notice, nor
 * the reverse, nor the operation itself.
 *
 * **The email does not hold the response.** The staff notice is a database write
 * and stays in line; the customer's email is an SMTP round trip, so it is handed
 * to `runAfterResponse` — `after()` in a request, a non-blocking promise elsewhere
 * — and a slow transport costs the customer's HTTP request nothing.
 */
export async function notifyOrderLifecycle(orderId: mongoose.Types.ObjectId, event: LifecycleEvent): Promise<void> {
  await afterCommit(`order lifecycle ${event.type}`, async () => {
    try {
      await raiseStaffNoticeForEvent(orderId, event);
    } catch (error) {
      console.error(`[notifications] order lifecycle ${event.type} step failed: ${error instanceof Error ? error.name : "unknown error"}`);
    }
    runAfterResponse(`order email ${event.type}`, () => emailCustomerForEvent(orderId, event));
  });
}

async function raiseStaffNoticeForEvent(orderId: mongoose.Types.ObjectId, event: LifecycleEvent): Promise<void> {
  const type = staffNotificationTypeForEvent(event.type);
  if (!type) return;
  const order = await orderRepository.findOne({ where: { _id: orderId }, skipThrowError: true, lean: true });
  if (!order) return;

  if (type === "NEW_ORDER") {
    await saveStaffNotification({ type, title: `New order ${order.orderNumber}`, link: AppRoute.ORDER(order._id.toString()), entityType: "Order", entityId: order._id });
  } else if (type === "PAYMENT_PROOF_SUBMITTED") {
    await saveStaffNotification({ type, title: `Payment proof submitted — ${order.orderNumber}`, body: "Waiting for verification.", link: AppRoute.PAYMENTS, entityType: "Order", entityId: order._id });
  } else if (type === "RETURN_REQUESTED") {
    // The timeline entry does not name the return; the newest one still awaiting a decision on this order is it.
    const requested = await returnRepository.findAll({ where: { orderId: order._id, status: "REQUESTED" }, sort: { field: "requestedAt", order: SortOrder.DESC }, take: 1, lean: true });
    const ret = requested[0];
    await saveStaffNotification(
      ret
        ? { type, title: `Return requested — ${ret.returnNumber}`, body: `On order ${order.orderNumber}.`, link: AppRoute.RETURN(ret._id.toString()), entityType: "Return", entityId: ret._id }
        : { type, title: `Return requested — order ${order.orderNumber}`, link: AppRoute.ORDER(order._id.toString()), entityType: "Order", entityId: order._id }
    );
  }
}

async function emailCustomerForEvent(orderId: mongoose.Types.ObjectId, event: LifecycleEvent): Promise<void> {
  const kind = orderEmailKindForEvent(event.type);
  if (!kind) return;

  const settings = await notificationSettingsRepository.findOne({ where: {}, skipThrowError: true, lean: true });
  if (!isEmailEnabledFor(settings?.events, event.type)) return;

  const order = await orderRepository.findOne({ where: { _id: orderId }, skipThrowError: true, lean: true });
  if (!order) return;

  let to = order.guestEmail || undefined;
  let name = order.guestName || undefined;
  if (!to && order.customerId) {
    const customer = await customerRepository.findOne({ where: { _id: order.customerId }, skipThrowError: true, lean: true });
    to = customer?.email || undefined;
    name = customer?.name || undefined;
  }
  // No contact email, no email: the order is still placed, still tracked, still visible — only the message has no address.
  if (!to) return;

  let refunded: Money | undefined;
  if (kind === "refund-recorded") {
    if (event.type === "PAYMENT_REFUNDED") refunded = order.payment.refund?.amount;
    else {
      const returnId = typeof event.metadata?.returnId === "string" ? event.metadata.returnId : undefined;
      const ret = returnId ? await returnRepository.findOne({ where: { _id: returnId }, skipThrowError: true, lean: true }) : null;
      refunded = ret?.refundAmount;
    }
  }

  await sendTemplatedEmail({
    template: kind,
    to,
    render: (context) => {
      const money = (value: Money) => (context.currency ? moneyView(context.currency, context.locale === "ar" ? "ar-EG" : "en-US").format(value) : value.toFixed(2));
      const input: OrderEmailInput = {
        kind,
        locale: context.locale,
        storeName: context.storeName,
        orderNumber: order.orderNumber,
        customerName: name,
        total: money(order.total),
        contactEmail: context.contactEmail,
        ...(kind === "payment-rejected" ? { reason: order.payment.verification?.rejectionReason ?? event.reason } : {}),
        ...(refunded ? { refundAmount: money(refunded) } : {}),
        ...(kind === "order-ready-for-pickup" && order.fulfilment.pickupLocationSnapshot
          ? { pickup: { name: order.fulfilment.pickupLocationSnapshot.name, address: order.fulfilment.pickupLocationSnapshot.address } }
          : {}),
      };
      return orderEmail(input);
    },
  });
}
