import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import type { OrderSchema, OrderTimelineEventType } from "../../commerce/order.schema";
import { buildTimelineView } from "./timeline-view";

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 10, minute));
const entry = (type: OrderTimelineEventType, minute: number): OrderSchema["timeline"][number] => ({
  type, at: at(minute), actorType: "STAFF", actorId: new mongoose.Types.ObjectId(), reason: "internal staff note", metadata: { secret: true },
});

describe("buildTimelineView", () => {
  it("keeps exactly { type, at } and drops actor, reason and metadata", () => {
    const [first] = buildTimelineView([entry("ORDER_CANCELLED", 1)]);
    expect(Object.keys(first!).sort()).toEqual(["at", "type"]);
    expect(JSON.stringify(first)).not.toContain("internal staff note");
  });

  it("includes status and payment progress and excludes return/refund events", () => {
    const visible: OrderTimelineEventType[] = ["ORDER_PLACED", "ORDER_CONFIRMED", "ORDER_PROCESSING", "ORDER_READY_FOR_PICKUP", "ORDER_SHIPPED", "ORDER_IN_TRANSIT", "ORDER_DELIVERED", "ORDER_COLLECTED", "ORDER_CANCELLED", "PAYMENT_SUBMITTED", "PAYMENT_VERIFIED", "PAYMENT_REJECTED", "PAYMENT_REFUNDED"];
    const hidden: OrderTimelineEventType[] = ["ORDER_TRACKING_UPDATED", "RETURN_REQUESTED", "RETURN_APPROVED", "RETURN_REJECTED", "RETURN_RECEIVED", "REFUND_ISSUED"];
    const view = buildTimelineView([...visible, ...hidden].map((type, index) => entry(type, index)));
    expect(view.map((e) => e.type)).toEqual(visible);
  });

  it("is chronological regardless of stored order, and tolerates no timeline", () => {
    expect(buildTimelineView([entry("ORDER_CONFIRMED", 5), entry("ORDER_PLACED", 1)]).map((e) => e.type)).toEqual(["ORDER_PLACED", "ORDER_CONFIRMED"]);
    expect(buildTimelineView(undefined)).toEqual([]);
  });
});
