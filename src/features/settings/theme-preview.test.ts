import { describe, expect, it } from "vitest";
import { measureFill, measureText, MIN_CONTRAST_RATIO } from "./theme-preview";

describe("measureFill", () => {
  it("leaves a fill that already clears the floor untouched", () => {
    const m = measureFill("#111111", "#FFFFFF");
    expect(m?.adjusted).toBe(false);
    expect(m?.inkHex.toLowerCase()).toBe("#111111");
    expect(m!.inkRatio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
  });
  it("derives a compliant ink for the recorded failing pair (#6B8F71 on white is 3.63:1)", () => {
    const m = measureFill("#6B8F71", "#FFFFFF");
    expect(m?.adjusted).toBe(true);
    expect(m!.fillRatio).toBeCloseTo(3.63, 1);
    expect(m!.inkRatio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO - 0.02);
    expect(m!.inkHex.toLowerCase()).not.toBe("#6b8f71");
  });
  it("returns null for a half-typed or invalid colour instead of throwing", () => {
    expect(measureFill("#6B8", "#FFFFFF")).toBeNull();
    expect(measureFill("#6B8F7", "#FFFFFF")).toBeNull();
    expect(measureFill("#6B8F71", "white")).toBeNull();
    expect(measureFill("", "")).toBeNull();
  });
});

describe("measureText", () => {
  it("flags body text that is too faint on the surface", () => {
    expect(measureText("#111111", "#FFFFFF")?.meetsMinimum).toBe(true);
    expect(measureText("#BBBBBB", "#FFFFFF")?.meetsMinimum).toBe(false);
    expect(measureText("nope", "#FFFFFF")).toBeNull();
  });
});
