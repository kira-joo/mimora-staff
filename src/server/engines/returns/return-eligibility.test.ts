import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { describe, expect, it } from "vitest";
import type { OrderTimelineEntry } from "../../commerce/order.schema";
import {
  allLinesReceived,
  assertInspectedCondition,
  assertRefundReference,
  assertReturnTransition,
  canTransitionReturn,
  checkReturnEligibility,
  customerReturnStatus,
  findDeliveredAt,
  validateReturnQuantities,
} from "./return-eligibility";

describe("checkReturnEligibility", () => {
  const deliveredAt = new Date("2026-08-01T00:00:00Z");

  it("is eligible within the window", () => {
    expect(checkReturnEligibility("DELIVERED", deliveredAt, new Date("2026-08-05T00:00:00Z"), 14)).toEqual({
      eligible: true,
    });
  });

  it("refuses once the window has passed", () => {
    expect(checkReturnEligibility("DELIVERED", deliveredAt, new Date("2026-08-20T00:00:00Z"), 14)).toEqual({
      eligible: false,
      reason: "WINDOW_EXPIRED",
    });
  });

  it("treats the boundary as still eligible", () => {
    expect(checkReturnEligibility("DELIVERED", deliveredAt, new Date("2026-08-15T00:00:00Z"), 14)).toEqual({
      eligible: true,
    });
  });

  it("treats a COLLECTED pickup order as delivered: eligible inside the window, expired outside it", () => {
    expect(checkReturnEligibility("COLLECTED", deliveredAt, new Date("2026-08-05T00:00:00Z"), 14)).toEqual({ eligible: true });
    expect(checkReturnEligibility("COLLECTED", deliveredAt, new Date("2026-08-20T00:00:00Z"), 14)).toEqual({ eligible: false, reason: "WINDOW_EXPIRED" });
  });

  it("refuses an order that was never delivered", () => {
    for (const status of ["PLACED", "CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "IN_TRANSIT", "CANCELLED"] as const) {
      expect(checkReturnEligibility(status, deliveredAt, new Date("2026-08-02T00:00:00Z"), 14)).toEqual({
        eligible: false,
        reason: "NOT_DELIVERED",
      });
    }
  });
});

describe("findDeliveredAt — where the return window starts", () => {
  const entry = (type: OrderTimelineEntry["type"], at: string): OrderTimelineEntry => ({ type, at: new Date(at), actorType: "STAFF" });

  it("starts at ORDER_DELIVERED for a delivery order", () => {
    const timeline = [entry("ORDER_PLACED", "2026-08-01T00:00:00Z"), entry("ORDER_SHIPPED", "2026-08-02T00:00:00Z"), entry("ORDER_DELIVERED", "2026-08-03T00:00:00Z")];
    expect(findDeliveredAt(timeline)).toEqual(new Date("2026-08-03T00:00:00Z"));
  });

  it("starts at ORDER_COLLECTED for a pickup order", () => {
    const timeline = [entry("ORDER_PLACED", "2026-08-01T00:00:00Z"), entry("ORDER_READY_FOR_PICKUP", "2026-08-02T00:00:00Z"), entry("ORDER_COLLECTED", "2026-08-04T00:00:00Z")];
    expect(findDeliveredAt(timeline)).toEqual(new Date("2026-08-04T00:00:00Z"));
  });

  it("is undefined while the order is still in flight — in transit is not completion", () => {
    expect(findDeliveredAt([entry("ORDER_PLACED", "2026-08-01T00:00:00Z"), entry("ORDER_IN_TRANSIT", "2026-08-02T00:00:00Z")])).toBeUndefined();
  });
});

describe("validateReturnQuantities", () => {
  const orderLines = [
    { orderLineId: "line-1", orderedQuantity: 3, alreadyReturnedQuantity: 0 },
    { orderLineId: "line-2", orderedQuantity: 5, alreadyReturnedQuantity: 2 },
  ];

  it("accepts a quantity within what remains", () => {
    expect(validateReturnQuantities([{ orderLineId: "line-1", requestedQuantity: 2 }], orderLines)).toEqual([
      { valid: true },
    ]);
  });

  it("accounts for quantity already returned against the same line", () => {
    // 5 ordered, 2 already returned — 3 remain.
    expect(validateReturnQuantities([{ orderLineId: "line-2", requestedQuantity: 3 }], orderLines)).toEqual([
      { valid: true },
    ]);
    expect(validateReturnQuantities([{ orderLineId: "line-2", requestedQuantity: 4 }], orderLines)).toEqual([
      { valid: false, orderLineId: "line-2", reason: "EXCEEDS_REMAINING" },
    ]);
  });

  it("refuses a line that doesn't belong to this order", () => {
    expect(validateReturnQuantities([{ orderLineId: "line-99", requestedQuantity: 1 }], orderLines)).toEqual([
      { valid: false, orderLineId: "line-99", reason: "LINE_NOT_FOUND" },
    ]);
  });

  it("refuses a zero or negative quantity", () => {
    expect(validateReturnQuantities([{ orderLineId: "line-1", requestedQuantity: 0 }], orderLines)).toEqual([
      { valid: false, orderLineId: "line-1", reason: "NOT_POSITIVE" },
    ]);
    expect(validateReturnQuantities([{ orderLineId: "line-1", requestedQuantity: -1 }], orderLines)).toEqual([
      { valid: false, orderLineId: "line-1", reason: "NOT_POSITIVE" },
    ]);
  });

  it("validates every requested line independently", () => {
    const results = validateReturnQuantities(
      [
        { orderLineId: "line-1", requestedQuantity: 1 },
        { orderLineId: "line-2", requestedQuantity: 999 },
      ],
      orderLines
    );
    expect(results[0]).toEqual({ valid: true });
    expect(results[1]).toMatchObject({ valid: false, reason: "EXCEEDS_REMAINING" });
  });
});

describe("the return state machine", () => {
  it("walks the approve-then-refund path", () => {
    expect(canTransitionReturn("REQUESTED", "APPROVED")).toBe(true);
    expect(canTransitionReturn("APPROVED", "REFUNDED")).toBe(true);
  });

  it("walks the receive path: APPROVED → RECEIVED → REFUNDED", () => {
    expect(canTransitionReturn("APPROVED", "RECEIVED")).toBe(true);
    expect(canTransitionReturn("RECEIVED", "REFUNDED")).toBe(true);
  });

  it("keeps the deliberate refund-without-waiting-for-goods path (APPROVED → REFUNDED)", () => {
    expect(() => assertReturnTransition("APPROVED", "REFUNDED")).not.toThrow();
  });

  it("RECEIVED cannot be rejected, un-received or skipped into from REQUESTED", () => {
    expect(canTransitionReturn("RECEIVED", "REJECTED")).toBe(false);
    expect(canTransitionReturn("RECEIVED", "APPROVED")).toBe(false);
    expect(canTransitionReturn("REQUESTED", "RECEIVED")).toBe(false);
    expect(canTransitionReturn("REFUNDED", "RECEIVED")).toBe(false);
    expect(canTransitionReturn("REJECTED", "RECEIVED")).toBe(false);
  });

  it("allows a rejection", () => {
    expect(canTransitionReturn("REQUESTED", "REJECTED")).toBe(true);
  });

  it("treats REJECTED and REFUNDED as terminal — unlike a rejected payment, a rejected return is not retriable", () => {
    expect(canTransitionReturn("REJECTED", "REQUESTED")).toBe(false);
    expect(canTransitionReturn("REFUNDED", "REQUESTED")).toBe(false);
  });

  it("refuses to refund a return that was never approved", () => {
    expect(canTransitionReturn("REQUESTED", "REFUNDED")).toBe(false);
  });

  it("requires a reason to reject", () => {
    expect(() => assertReturnTransition("REQUESTED", "REJECTED")).toThrow(/requires a reason/);
    expect(() => assertReturnTransition("REQUESTED", "REJECTED", "Item shows signs of use")).not.toThrow();
  });

  it("reports a repeated transition as a conflict", () => {
    expect(() => assertReturnTransition("APPROVED", "APPROVED")).toThrow(ConflictError);
  });

  it("refuses an invalid transition", () => {
    expect(() => assertReturnTransition("REJECTED", "APPROVED")).toThrow(ConflictError);
  });
});

describe("assertRefundReference", () => {
  it("requires a non-blank reference — no pretence of automation", () => {
    expect(() => assertRefundReference(undefined)).toThrow(/requires a reference/);
    expect(() => assertRefundReference("   ")).toThrow(/requires a reference/);
    expect(() => assertRefundReference("TXN-12345")).not.toThrow();
  });
});

describe("assertInspectedCondition", () => {
  it("requires a non-blank inspected condition at receipt", () => {
    expect(() => assertInspectedCondition(undefined)).toThrow(ConflictError);
    expect(() => assertInspectedCondition("   ")).toThrow(/inspected condition/);
    expect(() => assertInspectedCondition("Unopened")).not.toThrow();
  });
});

describe("allLinesReceived", () => {
  it("is true only when every line carries a disposition", () => {
    expect(allLinesReceived([{ disposition: "RESTOCK" }, { disposition: "DISCARD" }])).toBe(true);
    expect(allLinesReceived([{ disposition: "RESTOCK" }, {}])).toBe(false);
  });

  it("is false for a return with no lines — nothing was received", () => {
    expect(allLinesReceived([])).toBe(false);
  });
});

describe("customerReturnStatus", () => {
  it("shows RECEIVED to the customer as APPROVED and leaves every other status alone", () => {
    expect(customerReturnStatus("RECEIVED")).toBe("APPROVED");
    for (const status of ["REQUESTED", "APPROVED", "REJECTED", "REFUNDED"] as const) expect(customerReturnStatus(status)).toBe(status);
  });
});
