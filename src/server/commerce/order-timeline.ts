import type { Types } from "mongoose";
import { orderRepository } from "../core/repositories";
import { notifyOrderLifecycle } from "../notifications/order-lifecycle";
import type { OrderTimelineEntry } from "./order.schema";

/**
 * The one place `Order.timeline[]` is ever written.
 *
 * A typed append, not a raw `$push` literal, on purpose:
 * `restaurant-platform-staff`'s own `transitionOrder()` has a live
 * field-shape mismatch in its `$push` (writes `actor`, the schema declares
 * `actorId`; omits the schema's own required `actorType` entirely) that
 * `findOneAndUpdate` without `runValidators` never caught, and its own
 * integration test suite never asserted `timeline` contents — found during
 * the pre-implementation architecture review, cited there as the direct
 * reason to route every append through one typed function instead of ad hoc
 * literals at each call site. `entry: OrderTimelineEntry` is checked by the
 * compiler against the exact interface the schema declares, so the same
 * mismatch is a build error here, not a silent runtime gap.
 *
 * The repository resolves the ambient transaction session and reports the
 * write itself, so no `session` parameter is threaded through call sites.
 * `skipThrowError` keeps the prior no-op on a missing order.
 *
 * **It is also where an order event reaches the outside world.** Every
 * lifecycle event passes through here, so this is the one place that decides
 * what each one sends — the customer's email and the staff notice
 * (`notifications/order-lifecycle.ts`). Both are registered with `onCommit`
 * when a transaction is active, so a rolled-back transition notifies nobody,
 * and run straight after the write when none is. Neither can fail the append.
 */
export async function appendOrderTimelineEntry(orderId: Types.ObjectId, entry: OrderTimelineEntry): Promise<void> {
  await orderRepository.updateAtomic({ _id: orderId }, { $push: { timeline: entry } }, { skipThrowError: true });
  await notifyOrderLifecycle(orderId, entry);
}
