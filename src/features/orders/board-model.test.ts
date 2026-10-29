import { describe, expect, it } from "vitest";
import type { BoardCard } from "src/api/orders.endpoints";
import { ADVANCE_LABEL, advanceStepsFor, isOverdue, waitingLabel } from "./board-model";

const card = (overrides: Partial<Pick<BoardCard, "status" | "mode" | "paymentStatus">>) => ({ status: "PLACED" as const, mode: "DELIVERY" as const, paymentStatus: "NOT_REQUIRED" as const, ...overrides });

describe("advanceStepsFor", () => {
  it("offers the next step for the order's own mode — ship for delivery, ready for pickup for pickup", () => {
    expect(advanceStepsFor(card({ status: "PROCESSING", mode: "DELIVERY" })).map((step) => step.to)).toEqual(["SHIPPED"]);
    expect(advanceStepsFor(card({ status: "PROCESSING", mode: "PICKUP" })).map((step) => step.to)).toEqual(["READY_FOR_PICKUP"]);
  });

  it("offers the optional in-transit step AND delivered from shipped, and collected from ready", () => {
    expect(advanceStepsFor(card({ status: "SHIPPED" })).map((step) => step.to)).toEqual(["IN_TRANSIT", "DELIVERED"]);
    expect(advanceStepsFor(card({ status: "READY_FOR_PICKUP", mode: "PICKUP" })).map((step) => step.to)).toEqual(["COLLECTED"]);
  });

  it("never offers cancelling — that needs a reason, so it is not one tap", () => {
    for (const status of ["PLACED", "CONFIRMED", "PROCESSING", "SHIPPED", "IN_TRANSIT"] as const) {
      expect(advanceStepsFor(card({ status })).map((step) => step.to)).not.toContain("CANCELLED");
    }
  });

  it("has nothing to offer from a finished order", () => {
    expect(advanceStepsFor(card({ status: "DELIVERED" }))).toEqual([]);
    expect(advanceStepsFor(card({ status: "COLLECTED", mode: "PICKUP" }))).toEqual([]);
  });

  it("marks a hand-over blocked while payment is unverified — and leaves the pre-hand-over steps open", () => {
    expect(advanceStepsFor(card({ status: "PROCESSING", paymentStatus: "SUBMITTED" }))).toEqual([{ to: "SHIPPED", blocked: true }]);
    expect(advanceStepsFor(card({ status: "PLACED", paymentStatus: "AWAITING_PAYMENT" }))).toEqual([{ to: "CONFIRMED", blocked: false }]);
    expect(advanceStepsFor(card({ status: "PROCESSING", paymentStatus: "VERIFIED" }))).toEqual([{ to: "SHIPPED", blocked: false }]);
  });

  it("every step it can offer has a button label", () => {
    for (const status of ["PLACED", "CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "IN_TRANSIT"] as const) {
      for (const mode of ["DELIVERY", "PICKUP"] as const) {
        for (const { to } of advanceStepsFor(card({ status, mode }))) expect(ADVANCE_LABEL[to]).toBeTruthy();
      }
    }
  });
});

describe("waitingLabel / isOverdue", () => {
  const now = new Date("2026-03-10T12:00:00Z").getTime();
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  it("reads minutes, hours, then days", () => {
    expect(waitingLabel(ago(0), now)).toBe("just now");
    expect(waitingLabel(ago(12), now)).toBe("12 min");
    expect(waitingLabel(ago(180), now)).toBe("3 h");
    expect(waitingLabel(ago(60 * 24 * 3), now)).toBe("3 d");
  });

  it("never goes negative when the clock disagrees", () => {
    expect(waitingLabel(ago(-30), now)).toBe("just now");
  });

  it("is overdue from a day on", () => {
    expect(isOverdue(ago(60 * 24 - 1), now)).toBe(false);
    expect(isOverdue(ago(60 * 24), now)).toBe(true);
  });
});
