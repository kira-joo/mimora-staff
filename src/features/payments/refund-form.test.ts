import { describe, expect, it } from "vitest";
import { refundFormErrors } from "./refund-form";

describe("refundFormErrors", () => {
  it("requires a reference — blank and whitespace-only are refused with a field error", () => {
    expect(refundFormErrors({ amount: "10.00", reference: "" }).reference).toBeDefined();
    expect(refundFormErrors({ amount: "10.00", reference: "   " }).reference).toBeDefined();
  });

  it("accepts a real amount and reference with no errors", () => {
    expect(refundFormErrors({ amount: "250.00", reference: "TRX-9" })).toEqual({ amount: undefined, reference: undefined });
  });

  it.each(["", "abc", "0", "0.00", "-5", "1.234"])("refuses the amount %j", (amount) => {
    expect(refundFormErrors({ amount, reference: "TRX-9" }).amount).toBeDefined();
  });

  it("reports both fields at once", () => {
    const errors = refundFormErrors({ amount: "", reference: "" });
    expect(errors.amount).toBeDefined();
    expect(errors.reference).toBeDefined();
  });
});
