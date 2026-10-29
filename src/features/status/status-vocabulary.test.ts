import { describe, expect, it } from "vitest";
import { ORDER_STATUS, PAYMENT_STATUS, PRODUCT_LIFECYCLE, PROMOTION_STATUS, RETURN_STATUS, REVIEW_STATUS, TONE_VAR, paymentMethodLabel } from "./status-vocabulary";

describe("status vocabulary", () => {
  it("every status in every set has a label, an icon and a tone backed by a token", () => {
    for (const spec of [...Object.values(ORDER_STATUS), ...Object.values(PAYMENT_STATUS), ...Object.values(RETURN_STATUS), ...Object.values(PRODUCT_LIFECYCLE), ...Object.values(REVIEW_STATUS), ...Object.values(PROMOTION_STATUS)]) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.icon).toBeTruthy();
      expect(TONE_VAR[spec.tone]).toMatch(/^var\(--st-status-/);
    }
  });

  it("covers every order status the server's state machine knows, and reads the two new ones as the lifecycle does", () => {
    expect(Object.keys(ORDER_STATUS).sort()).toEqual(["CANCELLED", "COLLECTED", "CONFIRMED", "DELIVERED", "IN_TRANSIT", "PLACED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED"]);
    expect(ORDER_STATUS.IN_TRANSIT).toMatchObject({ label: "In transit", tone: ORDER_STATUS.SHIPPED.tone });
    // A collected pickup is as complete as a delivered delivery: same tone, so the board and list read them alike.
    expect(ORDER_STATUS.COLLECTED).toMatchObject({ label: "Collected", tone: ORDER_STATUS.DELIVERED.tone });
  });

  it("names configured payment methods, and humanizes unknown ones", () => {
    expect(paymentMethodLabel("COD")).toBe("Cash on delivery");
    expect(paymentMethodLabel("BANK_TRANSFER")).toBe("Bank transfer");
  });
});
