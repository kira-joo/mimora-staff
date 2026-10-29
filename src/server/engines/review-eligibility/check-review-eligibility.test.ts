import { describe, expect, it } from "vitest";
import { canReviewProduct } from "./check-review-eligibility";
import type { ReviewableOrder } from "./check-review-eligibility";

describe("canReviewProduct", () => {
  it("allows a review when a delivered order contains the product", () => {
    const orders: ReviewableOrder[] = [{ customerId: "c1", status: "DELIVERED", productIds: ["p1", "p2"] }];
    expect(canReviewProduct("p1", orders)).toBe(true);
  });

  it("refuses when the customer never bought the product at all", () => {
    const orders: ReviewableOrder[] = [{ customerId: "c1", status: "DELIVERED", productIds: ["p2"] }];
    expect(canReviewProduct("p1", orders)).toBe(false);
  });

  it("refuses when the order containing the product was never delivered", () => {
    for (const status of ["PLACED", "CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "IN_TRANSIT", "CANCELLED"] as const) {
      const orders: ReviewableOrder[] = [{ customerId: "c1", status, productIds: ["p1"] }];
      expect(canReviewProduct("p1", orders)).toBe(false);
    }
  });

  it("allows a review when a pickup order was COLLECTED — collected is delivered, for a pickup", () => {
    const orders: ReviewableOrder[] = [{ customerId: "c1", status: "COLLECTED", productIds: ["p1"] }];
    expect(canReviewProduct("p1", orders)).toBe(true);
  });

  it("allows a review if ANY of several orders qualifies", () => {
    const orders: ReviewableOrder[] = [
      { customerId: "c1", status: "CANCELLED", productIds: ["p1"] },
      { customerId: "c1", status: "DELIVERED", productIds: ["p3"] },
      { customerId: "c1", status: "DELIVERED", productIds: ["p1"] },
    ];
    expect(canReviewProduct("p1", orders)).toBe(true);
  });

  it("refuses with no order history at all", () => {
    expect(canReviewProduct("p1", [])).toBe(false);
  });
});
