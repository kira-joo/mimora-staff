import { describe, expect, it } from "vitest";
import { barShare, isNegative, periodLabel } from "./sales-display";

describe("periodLabel", () => {
  it("formats a day key without shifting it through a time zone", () => {
    expect(periodLabel("2026-10-02", "day")).toBe("Fri 02 Oct");
    expect(periodLabel("2026-01-01", "day")).toBe("Thu 01 Jan");
  });

  it("formats a month key", () => {
    expect(periodLabel("2026-10", "month")).toBe("Oct 2026");
  });

  it("leaves an unrecognised key as it is", () => {
    expect(periodLabel("week-40", "day")).toBe("week-40");
  });
});

describe("barShare", () => {
  const values = ["100.00", "250.50", "0.00", "-40.00"];

  it("scales to the largest value", () => {
    expect(barShare("250.50", values)).toBe(1);
    expect(barShare("100.00", values)).toBeCloseTo(0.3992, 3);
  });

  it("draws nothing for zero, negative, or an all-zero range", () => {
    expect(barShare("0.00", values)).toBe(0);
    expect(barShare("-40.00", values)).toBe(0);
    expect(barShare("0.00", ["0.00"])).toBe(0);
  });
});

describe("isNegative", () => {
  it.each([
    ["-0.01", true],
    ["0.00", false],
    ["120.00", false],
  ])("%s → %s", (value, expected) => expect(isNegative(value)).toBe(expected));
});

