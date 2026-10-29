import { describe, expect, it } from "vitest";
import { inspectedConditionErrors, receivableLines, refundAmountError } from "./return-helpers";

describe("refundAmountError", () => {
  it.each(["", "  ", "abc", "-5", "1.234", "0", "0.00"])("rejects %j", (value) => {
    expect(refundAmountError(value)).toBeDefined();
  });
  it.each(["1", "10.5", "120.00", "0.01"])("accepts %j", (value) => {
    expect(refundAmountError(value)).toBeUndefined();
  });
});

describe("receivableLines", () => {
  it("keeps only lines without a disposition", () => {
    const base = { orderLineId: "", variantId: "", sku: "", productName: "", variantDescription: "", quantity: 1, reason: "", condition: "" };
    const lines = [
      { ...base, returnLineId: "a" },
      { ...base, returnLineId: "b", disposition: "RESTOCK" as const },
    ];
    expect(receivableLines(lines).map((l) => l.returnLineId)).toEqual(["a"]);
  });
});

describe("inspectedConditionErrors", () => {
  it("flags every line whose condition is blank or whitespace, and only those", () => {
    expect(
      inspectedConditionErrors([
        { id: "a", inspectedCondition: "" },
        { id: "b", inspectedCondition: "   " },
        { id: "c", inspectedCondition: "Unopened" },
      ])
    ).toEqual({ a: expect.any(String), b: expect.any(String) });
  });

  it("is empty when every line has a condition", () => {
    expect(inspectedConditionErrors([{ id: "a", inspectedCondition: "Damaged box" }])).toEqual({});
  });
});
