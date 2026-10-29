import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";
import {
  fulfilmentSettingsRepository,
  orderLineRepository,
  orderRepository,
  returnLineRepository,
  returnRepository,
} from "../../core/repositories";
import { appendOrderTimelineEntry } from "../../commerce/order-timeline";
import { allocateReturnNumber } from "../../engines/return-number/allocate-return-number";
import { checkReturnEligibility, findDeliveredAt, validateReturnQuantities } from "../../engines/returns/return-eligibility";
import type { OrderLineReturnState, ReturnLineQuantityCheck } from "../../engines/returns/returns.types";
import type { ReturnListItemView } from "./returns.types";

export interface RequestReturnLineInput {
  orderLineId: string;
  quantity: number;
  reason: string;
  condition: string;
}

export interface RequestReturnInput {
  customer: CustomerIdentity;
  orderNumber: string;
  reason: string;
  lines: RequestReturnLineInput[];
  now: Date;
}

/**
 * Requests a return for `POST /api/shop/returns`.
 *
 * Validates, in order:
 * - Order exists and belongs to this customer
 * - Order is `DELIVERED` (or `COLLECTED`, for pickup) and within
 *   `FulfilmentSettings.returnWindowDays` of its `ORDER_DELIVERED` /
 *   `ORDER_COLLECTED` timeline entry (`return-eligibility.ts`'s own
 *   `checkReturnEligibility`) — a `DELIVERED` order with no such entry (a
 *   data-integrity edge case older than Phase 4A.5's timeline) is treated
 *   as `NOT_DELIVERED` rather than inventing a third rejection reason.
 * - Every requested line's quantity, against what was ordered minus what a
 *   prior non-`REJECTED` return already claimed (`validateReturnQuantities`)
 *   — a line the customer doesn't own on this order surfaces as the same
 *   `LINE_NOT_FOUND` rejection the engine already defines, not a special
 *   case this service invents.
 *
 * Transactionally: allocates the return number, creates the `Return` and
 * its `ReturnLine`s, and appends `RETURN_REQUESTED` to `Order.timeline`.
 * `Order.status` itself is never touched — no return-related value exists
 * on that enum.
 *
 * No external I/O, no stock movement, no payment/refund — those belong to
 * the staff approve/reject/receive routes, not built in this batch.
 *
 * The repositories pick up the ambient transaction session themselves.
 */
export async function requestReturn(input: RequestReturnInput): Promise<ReturnListItemView> {
  const { customer, orderNumber, reason, lines, now } = input;

  const order = await orderRepository.findOne({ where: { orderNumber, customerId: customer._id }, skipThrowError: true });
  if (!order) {
    throw new NotFoundError("Order not found.");
  }

  const fulfilmentSettings = await fulfilmentSettingsRepository.findOne({ where: {}, skipThrowError: true });
  const returnWindowDays = fulfilmentSettings?.returnWindowDays ?? 14;

  const deliveredAt = findDeliveredAt(order.timeline);
  const eligibility = deliveredAt
    ? checkReturnEligibility(order.status, deliveredAt, now, returnWindowDays)
    : ({ eligible: false, reason: "NOT_DELIVERED" } as const);

  if (!eligibility.eligible) {
    throw new ConflictError(
      eligibility.reason === "NOT_DELIVERED"
        ? "This order has not been delivered yet."
        : "The return window for this order has expired."
    );
  }

  // Every real line on this order, with how much of it prior non-REJECTED
  // returns already claim — REQUESTED, APPROVED, and REFUNDED all count;
  // only a REJECTED return returned nothing.
  const orderLines = await orderLineRepository.findAll({ where: { orderId: order._id } });

  const existingReturns = await returnRepository.findAll({ where: { orderId: order._id, status: { $ne: "REJECTED" } } });
  const existingReturnLines = existingReturns.length
    ? await returnLineRepository.findAll({ where: { returnId: { $in: existingReturns.map((r) => r._id) } } })
    : [];

  const alreadyReturnedByLine = new Map<string, number>();
  for (const returnLine of existingReturnLines) {
    const key = returnLine.orderLineId.toString();
    alreadyReturnedByLine.set(key, (alreadyReturnedByLine.get(key) ?? 0) + returnLine.quantity);
  }

  const orderLineStates: OrderLineReturnState[] = orderLines.map((orderLine) => ({
    orderLineId: orderLine._id.toString(),
    orderedQuantity: orderLine.quantity,
    alreadyReturnedQuantity: alreadyReturnedByLine.get(orderLine._id.toString()) ?? 0,
  }));

  const quantityChecks: ReturnLineQuantityCheck[] = lines.map((line) => ({
    orderLineId: line.orderLineId,
    requestedQuantity: line.quantity,
  }));

  const validations = validateReturnQuantities(quantityChecks, orderLineStates);
  const failure = validations.find((validation) => !validation.valid);
  if (failure && !failure.valid) {
    const messages: Record<typeof failure.reason, string> = {
      LINE_NOT_FOUND: "does not exist on this order",
      EXCEEDS_REMAINING: "exceeds the remaining returnable quantity for that line",
      NOT_POSITIVE: "must be a positive quantity",
    };
    if (failure.reason === "LINE_NOT_FOUND") {
      throw new NotFoundError(`Order line ${messages[failure.reason]}.`);
    }
    throw new ConflictError(`The requested quantity for order line ${failure.orderLineId} ${messages[failure.reason]}.`);
  }

  return withTransaction(async (tx) => {
    const returnNumber = await allocateReturnNumber();

    const createdReturn = await returnRepository.save({
      orderId: order._id,
      customerId: new mongoose.Types.ObjectId(customer._id),
      returnNumber,
      reason,
      status: "REQUESTED",
      requestedAt: now,
    });

    await returnLineRepository.save(
      lines.map((line) => ({
        returnId: createdReturn._id,
        orderLineId: new mongoose.Types.ObjectId(line.orderLineId),
        quantity: line.quantity,
        reason: line.reason,
        condition: line.condition,
      }))
    );

    await appendOrderTimelineEntry(order._id, {
      type: "RETURN_REQUESTED",
      at: now,
      actorType: "CUSTOMER",
      actorId: new mongoose.Types.ObjectId(customer._id),
      reason,
    });

    return tx.complete({
      returnId: createdReturn._id.toString(),
      returnNumber,
      orderNumber: order.orderNumber,
      status: "REQUESTED" as const,
      reason,
      requestedAt: now,
      lineCount: lines.length,
    });
  });
}
