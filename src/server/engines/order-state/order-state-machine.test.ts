import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { describe, expect, it } from "vitest";
import {
  assertPaymentTransition,
  assertTransition,
  canCustomerCancel,
  canTransition,
  canTransitionPayment,
  initialPaymentStatus,
  isCompletedStatus,
  isTerminalStatus,
  nextStatuses,
  paymentAllowsTransition,
  releasesStock,
  timelineEventForStatus,
} from "./order-state-machine";
import type { FulfilmentMode, OrderStatus } from "./order-state.types";

const DELIVERY = "DELIVERY" as const;
const PICKUP = "PICKUP" as const;

/**
 * THE contract, written out edge by edge: for each fulfilment mode, the exact set of next statuses from each status.
 * The exhaustive test below checks every one of the 9 x 9 (from, to) pairs per mode against it, so adding a status
 * or an edge without deciding it here fails — and so does an edge the map grew by accident.
 */
const ALL_STATUSES: readonly OrderStatus[] = ["PLACED", "CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "IN_TRANSIT", "DELIVERED", "COLLECTED", "CANCELLED"];

const EXPECTED: Record<FulfilmentMode, Record<OrderStatus, readonly OrderStatus[]>> = {
  DELIVERY: {
    PLACED: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["PROCESSING", "CANCELLED"],
    PROCESSING: ["SHIPPED", "CANCELLED"],
    // A delivery order is never READY_FOR_PICKUP, so this row is unreachable — but cancelling is the one edge the
    // map still offers from it, and the table says so rather than leaving it to surprise someone.
    READY_FOR_PICKUP: ["CANCELLED"],
    SHIPPED: ["IN_TRANSIT", "DELIVERED", "CANCELLED"],
    IN_TRANSIT: ["DELIVERED", "CANCELLED"],
    DELIVERED: [],
    COLLECTED: [],
    CANCELLED: [],
  },
  PICKUP: {
    PLACED: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["PROCESSING", "CANCELLED"],
    PROCESSING: ["READY_FOR_PICKUP", "CANCELLED"],
    READY_FOR_PICKUP: ["COLLECTED", "CANCELLED"],
    // Unreachable for pickup (see the matching note above); cancelling is all the map offers.
    SHIPPED: ["CANCELLED"],
    IN_TRANSIT: ["CANCELLED"],
    DELIVERED: [],
    COLLECTED: [],
    CANCELLED: [],
  },
};

describe("every transition, allowed and forbidden, in both fulfilment modes", () => {
  for (const mode of [DELIVERY, PICKUP]) {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const allowed = EXPECTED[mode][from].includes(to);
        it(`${mode}: ${from} -> ${to} is ${allowed ? "allowed" : "refused"}`, () => {
          const attempt = () => assertTransition({ from, to, mode, paymentStatus: "VERIFIED", reason: "because" });
          if (allowed) expect(attempt).not.toThrow();
          else expect(attempt).toThrow(ConflictError);
        });
      }
    }

    it(`${mode}: nextStatuses offers exactly the allowed edges`, () => {
      for (const from of ALL_STATUSES) expect(nextStatuses(from, mode)).toEqual(EXPECTED[mode][from]);
    });
  }

  it("terminal states are exactly DELIVERED, COLLECTED and CANCELLED", () => {
    expect(ALL_STATUSES.filter(isTerminalStatus)).toEqual(["DELIVERED", "COLLECTED", "CANCELLED"]);
  });

  it("every status has its own timeline event, and the new ones are named for the status", () => {
    const events = ALL_STATUSES.map(timelineEventForStatus);
    expect(new Set(events).size).toBe(ALL_STATUSES.length);
    expect(timelineEventForStatus("IN_TRANSIT")).toBe("ORDER_IN_TRANSIT");
    expect(timelineEventForStatus("COLLECTED")).toBe("ORDER_COLLECTED");
  });
});

describe("the happy paths", () => {
  it("walks a delivery order end to end", () => {
    const path = ["PLACED", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"] as const;

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(() =>
        assertTransition({ from: path[index]!, to: path[index + 1]!, mode: DELIVERY, paymentStatus: "NOT_REQUIRED" })
      ).not.toThrow();
    }
  });

  it("walks a delivery order through the optional in-transit step", () => {
    const path = ["PLACED", "CONFIRMED", "PROCESSING", "SHIPPED", "IN_TRANSIT", "DELIVERED"] as const;

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(() =>
        assertTransition({ from: path[index]!, to: path[index + 1]!, mode: DELIVERY, paymentStatus: "NOT_REQUIRED" })
      ).not.toThrow();
    }
  });

  it("walks a pickup order end to end, ending in COLLECTED", () => {
    const path = ["PLACED", "CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "COLLECTED"] as const;

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(() =>
        assertTransition({ from: path[index]!, to: path[index + 1]!, mode: PICKUP, paymentStatus: "NOT_REQUIRED" })
      ).not.toThrow();
    }
  });
});

describe("forbidden transitions", () => {
  it("refuses to skip states", () => {
    expect(canTransition("PLACED", "PROCESSING")).toBe(false);
    expect(canTransition("PLACED", "DELIVERED")).toBe(false);
    expect(canTransition("PROCESSING", "IN_TRANSIT")).toBe(false);
    expect(canTransition("CONFIRMED", "DELIVERED")).toBe(false);
  });

  it("refuses to go backwards", () => {
    expect(canTransition("PROCESSING", "CONFIRMED")).toBe(false);
    expect(canTransition("READY_FOR_PICKUP", "PROCESSING")).toBe(false);
    expect(canTransition("SHIPPED", "PROCESSING")).toBe(false);
    expect(canTransition("IN_TRANSIT", "SHIPPED")).toBe(false);
  });

  it("treats terminal states as final", () => {
    for (const terminal of ["DELIVERED", "COLLECTED", "CANCELLED"] as const) {
      expect(isTerminalStatus(terminal)).toBe(true);
      expect(() => assertTransition({ from: terminal, to: "PROCESSING", mode: DELIVERY, paymentStatus: "NOT_REQUIRED" })).toThrow(
        ConflictError
      );
    }
  });

  it("reports a no-op transition as a conflict, not a success", () => {
    /*
     * The usual cause is two staff members acting on the same order at once.
     * The one who arrives second must be told the state moved under them — a
     * silent no-op would leave them believing their action landed.
     */
    expect(() => assertTransition({ from: "PROCESSING", to: "PROCESSING", mode: DELIVERY, paymentStatus: "NOT_REQUIRED" })).toThrow(
      /already PROCESSING/
    );
  });
});

describe("fulfilment mode gating", () => {
  it("never ships a pickup order", () => {
    expect(() =>
      assertTransition({ from: "PROCESSING", to: "SHIPPED", mode: PICKUP, paymentStatus: "NOT_REQUIRED" })
    ).toThrow(/does not apply to a PICKUP order/);
  });

  it("never lets a pickup order be marked in transit, delivered or shipped — it ends in COLLECTED", () => {
    expect(() => assertTransition({ from: "READY_FOR_PICKUP", to: "DELIVERED", mode: PICKUP, paymentStatus: "NOT_REQUIRED" })).toThrow(ConflictError);
    expect(() => assertTransition({ from: "SHIPPED", to: "IN_TRANSIT", mode: PICKUP, paymentStatus: "NOT_REQUIRED" })).toThrow(ConflictError);
  });

  it("never collects a delivery order", () => {
    expect(() => assertTransition({ from: "SHIPPED", to: "COLLECTED", mode: DELIVERY, paymentStatus: "NOT_REQUIRED" })).toThrow(ConflictError);
  });

  it("never marks a delivery order ready for pickup", () => {
    // It would vanish from the driver's lane.
    expect(() =>
      assertTransition({ from: "PROCESSING", to: "READY_FOR_PICKUP", mode: DELIVERY, paymentStatus: "NOT_REQUIRED" })
    ).toThrow(/does not apply to a DELIVERY order/);
  });

  it("offers only mode-appropriate next states to the board", () => {
    expect(nextStatuses("PROCESSING", DELIVERY)).toEqual(["SHIPPED", "CANCELLED"]);
    expect(nextStatuses("PROCESSING", PICKUP)).toEqual(["READY_FOR_PICKUP", "CANCELLED"]);
    expect(nextStatuses("DELIVERED", DELIVERY)).toEqual([]);
    expect(nextStatuses("SHIPPED", DELIVERY)).toEqual(["IN_TRANSIT", "DELIVERED", "CANCELLED"]);
    expect(nextStatuses("READY_FOR_PICKUP", PICKUP)).toEqual(["COLLECTED", "CANCELLED"]);
  });
});

describe("reasons", () => {
  it("requires one to cancel", () => {
    // Without it the customer is told the order will not happen and given
    // nothing to act on.
    expect(() => assertTransition({ from: "PLACED", to: "CANCELLED", mode: DELIVERY, paymentStatus: "NOT_REQUIRED" })).toThrow(
      /requires a reason/
    );
  });

  it("rejects a blank reason as no reason", () => {
    expect(() =>
      assertTransition({ from: "PLACED", to: "CANCELLED", mode: DELIVERY, paymentStatus: "NOT_REQUIRED", reason: "   " })
    ).toThrow(/requires a reason/);
  });

  it("accepts a real reason", () => {
    expect(() =>
      assertTransition({ from: "PLACED", to: "CANCELLED", mode: DELIVERY, paymentStatus: "NOT_REQUIRED", reason: "Customer changed mind" })
    ).not.toThrow();
  });

  it("does not require one for an ordinary advance", () => {
    expect(() => assertTransition({ from: "PLACED", to: "CONFIRMED", mode: DELIVERY, paymentStatus: "NOT_REQUIRED" })).not.toThrow();
  });
});

describe("releasesStock", () => {
  it("returns stock when an order is cancelled from any holding state", () => {
    /*
     * An order holds its decremented stock from placement until it completes.
     * Not returning it means inventory lost to an order that never happened.
     */
    for (const from of ["PLACED", "CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "IN_TRANSIT"] as const) {
      expect(releasesStock(from, "CANCELLED")).toBe(true);
    }
  });

  it("does not return stock on delivery — it was genuinely consumed", () => {
    expect(releasesStock("SHIPPED", "DELIVERED")).toBe(false);
    expect(releasesStock("IN_TRANSIT", "DELIVERED")).toBe(false);
    expect(releasesStock("READY_FOR_PICKUP", "COLLECTED")).toBe(false);
  });

  it("does not return stock twice", () => {
    // A terminal state is no longer holding any.
    expect(releasesStock("CANCELLED", "CANCELLED")).toBe(false);
    expect(releasesStock("DELIVERED", "CANCELLED")).toBe(false);
    expect(releasesStock("COLLECTED", "CANCELLED")).toBe(false);
  });

  it("does not return stock on an ordinary advance", () => {
    expect(releasesStock("PLACED", "CONFIRMED")).toBe(false);
  });
});

describe("canCustomerCancel", () => {
  const placedAt = new Date("2026-08-28T12:00:00Z");

  it("allows cancellation inside the window", () => {
    expect(canCustomerCancel("PLACED", placedAt, new Date("2026-08-28T12:03:00Z"), 5)).toBe(true);
  });

  it("refuses once the window has passed", () => {
    expect(canCustomerCancel("PLACED", placedAt, new Date("2026-08-28T12:06:00Z"), 5)).toBe(false);
  });

  it("refuses once processing has started, whatever the window says", () => {
    // Cancelling then costs the merchant real work already done.
    expect(canCustomerCancel("PROCESSING", placedAt, new Date("2026-08-28T12:01:00Z"), 5)).toBe(false);
  });

  it("treats the boundary as still cancellable", () => {
    expect(canCustomerCancel("PLACED", placedAt, new Date("2026-08-28T12:05:00Z"), 5)).toBe(true);
  });

  it("refuses on a terminal order, delivered or collected alike", () => {
    expect(canCustomerCancel("DELIVERED", placedAt, new Date("2026-08-28T12:01:00Z"), 5)).toBe(false);
    expect(canCustomerCancel("COLLECTED", placedAt, new Date("2026-08-28T12:01:00Z"), 5)).toBe(false);
  });

  it("refuses once the order has left the building", () => {
    for (const status of ["READY_FOR_PICKUP", "SHIPPED", "IN_TRANSIT"] as const) {
      expect(canCustomerCancel(status, placedAt, new Date("2026-08-28T12:01:00Z"), 5)).toBe(false);
    }
  });

  describe("with the deadline snapshotted at placement (Order.customerCancelUntil)", () => {
    const cancelUntil = new Date("2026-08-28T12:05:00Z");

    it("honours the snapshot over a window the merchant has since widened", () => {
      // 12:10 is inside a 30-minute window but past the order's own 12:05 promise.
      expect(canCustomerCancel("PLACED", placedAt, new Date("2026-08-28T12:10:00Z"), 30, cancelUntil)).toBe(false);
    });

    it("honours the snapshot over a window the merchant has since narrowed", () => {
      expect(canCustomerCancel("PLACED", placedAt, new Date("2026-08-28T12:04:00Z"), 1, cancelUntil)).toBe(true);
    });

    it("treats the deadline itself as still cancellable, and a millisecond later as too late", () => {
      expect(canCustomerCancel("PLACED", placedAt, cancelUntil, 5, cancelUntil)).toBe(true);
      expect(canCustomerCancel("PLACED", placedAt, new Date(cancelUntil.getTime() + 1), 5, cancelUntil)).toBe(false);
    });

    it("still refuses once processing has started", () => {
      expect(canCustomerCancel("PROCESSING", placedAt, new Date("2026-08-28T12:01:00Z"), 5, cancelUntil)).toBe(false);
    });
  });
});

describe("payment status", () => {
  it("starts NOT_REQUIRED for COD and AWAITING_PAYMENT for a manually-verified method", () => {
    // Cash owes nothing until handover, so reusing a pending state would leave
    // every COD order looking unpaid on the board forever.
    expect(initialPaymentStatus(false)).toBe("NOT_REQUIRED");
    expect(initialPaymentStatus(true)).toBe("AWAITING_PAYMENT");
  });

  it("walks the transfer-proof path", () => {
    expect(canTransitionPayment("AWAITING_PAYMENT", "SUBMITTED")).toBe(true);
    expect(canTransitionPayment("SUBMITTED", "VERIFIED")).toBe(true);
    expect(canTransitionPayment("SUBMITTED", "REJECTED")).toBe(true);
  });

  it("lets a rejected payment be retried — a rejection is never a dead end", () => {
    expect(canTransitionPayment("REJECTED", "AWAITING_PAYMENT")).toBe(true);
    expect(canTransitionPayment("REJECTED", "SUBMITTED")).toBe(true);
  });

  it("refuses to verify before proof exists", () => {
    expect(canTransitionPayment("AWAITING_PAYMENT", "VERIFIED")).toBe(false);
  });

  it("treats REFUNDED as terminal", () => {
    expect(canTransitionPayment("REFUNDED", "VERIFIED")).toBe(false);
  });

  it("requires a reason to reject", () => {
    expect(() => assertPaymentTransition("SUBMITTED", "REJECTED")).toThrow(/requires a reason/);
    expect(() =>
      assertPaymentTransition("SUBMITTED", "REJECTED", "Amount does not match")
    ).not.toThrow();
  });

  it("reports a repeated verification as a conflict", () => {
    expect(() => assertPaymentTransition("VERIFIED", "VERIFIED")).toThrow(/already VERIFIED/);
  });

  it("allows a COD order to eventually be refunded via a return", () => {
    expect(canTransitionPayment("NOT_REQUIRED", "REFUNDED")).toBe(true);
  });
});

describe("the two axes are independent", () => {
  it("lets a COD order progress while unpaid", () => {
    // The whole reason payment is a separate axis.
    expect(() => assertTransition({ from: "PROCESSING", to: "SHIPPED", mode: DELIVERY, paymentStatus: "NOT_REQUIRED" })).not.toThrow();
    expect(initialPaymentStatus(false)).toBe("NOT_REQUIRED");
  });

  it("lets a transfer order be verified before it is confirmed", () => {
    expect(canTransitionPayment("SUBMITTED", "VERIFIED")).toBe(true);
    expect(canTransition("PLACED", "CONFIRMED")).toBe(true);
  });
});

describe("the payment guard on hand-over states", () => {
  const GATED = [
    { to: "SHIPPED", from: "PROCESSING", mode: DELIVERY },
    { to: "READY_FOR_PICKUP", from: "PROCESSING", mode: PICKUP },
    { to: "IN_TRANSIT", from: "SHIPPED", mode: DELIVERY },
    { to: "DELIVERED", from: "SHIPPED", mode: DELIVERY },
    { to: "DELIVERED", from: "IN_TRANSIT", mode: DELIVERY },
    { to: "COLLECTED", from: "READY_FOR_PICKUP", mode: PICKUP },
  ] as const;

  for (const { to, from, mode } of GATED) {
    for (const paymentStatus of ["AWAITING_PAYMENT", "SUBMITTED", "REJECTED", "REFUNDED"] as const) {
      it(`refuses ${from} -> ${to} while payment is ${paymentStatus}`, () => {
        expect(() => assertTransition({ from, to, mode, paymentStatus })).toThrow(ConflictError);
        expect(() => assertTransition({ from, to, mode, paymentStatus })).toThrow(
          "Payment has not been verified — verify the receipt before shipping."
        );
        expect(paymentAllowsTransition(to, paymentStatus)).toBe(false);
      });
    }

    for (const paymentStatus of ["VERIFIED", "NOT_REQUIRED"] as const) {
      it(`allows ${from} -> ${to} when payment is ${paymentStatus}`, () => {
        expect(() => assertTransition({ from, to, mode, paymentStatus })).not.toThrow();
        expect(paymentAllowsTransition(to, paymentStatus)).toBe(true);
      });
    }
  }

  it("never gates cancellation or the pre-hand-over steps, whatever the payment status", () => {
    for (const paymentStatus of ["AWAITING_PAYMENT", "SUBMITTED", "REJECTED", "VERIFIED", "NOT_REQUIRED", "REFUNDED"] as const) {
      for (const to of ["CONFIRMED", "PROCESSING", "CANCELLED"] as const) {
        expect(paymentAllowsTransition(to, paymentStatus)).toBe(true);
      }
      expect(() =>
        assertTransition({ from: "PROCESSING", to: "CANCELLED", mode: DELIVERY, paymentStatus, reason: "x" })
      ).not.toThrow();
    }
  });

  it("keeps the allowed-transitions map independent of payment", () => {
    expect(canTransition("PROCESSING", "SHIPPED")).toBe(true);
    expect(nextStatuses("PROCESSING", DELIVERY)).toContain("SHIPPED");
  });
});

describe("isCompletedStatus — what 'the customer has their goods' means", () => {
  it("is DELIVERED and COLLECTED, and nothing else", () => {
    // Reviews, the return window and the customer's cancel rights all ask this, never `=== "DELIVERED"`.
    expect(ALL_STATUSES.filter(isCompletedStatus)).toEqual(["DELIVERED", "COLLECTED"]);
  });
});
