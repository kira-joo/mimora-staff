import { describe, expect, it } from "vitest";
import { AppPermission, CustomPermission } from "../../../common/authorization/authorization-registry";
import { isTerminalStatus } from "../order-state/order-state-machine";
import type { OrderStatus } from "../order-state/order-state.types";
import { OPEN_ORDER_STATUSES, TERMINAL_ORDER_STATUSES, TODAY_PERMISSIONS, TODAY_SECTIONS, openOrderCounts, todaySectionsFor } from "./today-sections";

const ALL: OrderStatus[] = ["PLACED", "CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "IN_TRANSIT", "DELIVERED", "COLLECTED", "CANCELLED"];

describe("today sections", () => {
  it("the open/terminal split agrees with the order state machine for every status", () => {
    for (const status of ALL) {
      expect(TERMINAL_ORDER_STATUSES.includes(status), status).toBe(isTerminalStatus(status));
      expect(OPEN_ORDER_STATUSES.includes(status), status).toBe(!isTerminalStatus(status));
    }
  });

  it("each permission shows only its own panel", () => {
    expect(todaySectionsFor((p) => p === CustomPermission.REPORT_READ)).toEqual(["sales"]);
    expect(todaySectionsFor((p) => p === AppPermission.ORDER.READ)).toEqual(["orders"]);
    expect(todaySectionsFor((p) => p === CustomPermission.PAYMENT_VERIFY)).toEqual(["payments"]);
    expect(todaySectionsFor(() => false)).toEqual([]);
    expect(todaySectionsFor(() => true)).toEqual([...TODAY_SECTIONS]);
  });

  it("the route's any-of permission list covers every panel's permission", () => {
    expect(TODAY_PERMISSIONS).toHaveLength(TODAY_SECTIONS.length);
  });

  it("openOrderCounts zero-fills known open statuses in lifecycle order and ignores terminal ones", () => {
    const counts = openOrderCounts([
      { status: "SHIPPED", count: 2 },
      { status: "PLACED", count: 5 },
      { status: "DELIVERED", count: 99 },
    ]);
    expect(counts.map((c) => c.status)).toEqual([...OPEN_ORDER_STATUSES]);
    expect(counts.find((c) => c.status === "PLACED")?.count).toBe(5);
    expect(counts.find((c) => c.status === "CONFIRMED")?.count).toBe(0);
    expect(counts.some((c) => c.status === "DELIVERED")).toBe(false);
  });

  it("an unknown non-terminal status is appended, not dropped", () => {
    expect(openOrderCounts([{ status: "ON_HOLD", count: 3 }]).at(-1)).toEqual({ status: "ON_HOLD", count: 3 });
  });
});
