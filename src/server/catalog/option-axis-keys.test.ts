import { describe, expect, it } from "vitest";
import { axisKeysChanged } from "./option-axis-keys";

const axes = (...keys: string[]) => keys.map((key) => ({ key, name: { en: key.toUpperCase(), ar: "" } }));

describe("axisKeysChanged", () => {
  it("is false for the same keys, in any order, with any display names", () => {
    expect(axisKeysChanged(axes("size", "colour"), axes("colour", "size"))).toBe(false);
    const renamed: Array<{ key: string; name: { en: string; ar: string } }> = [{ key: "size", name: { en: "Fit size", ar: "المقاس" } }];
    expect(axisKeysChanged(axes("size"), renamed)).toBe(false);
  });

  it.each([
    ["adding a key", axes("size"), axes("size", "colour")],
    ["removing a key", axes("size", "colour"), axes("size")],
    ["renaming a key", axes("size"), axes("fit")],
    ["replacing all keys", axes("size", "colour"), axes("fit", "shade")],
  ])("is true for %s", (_, current, next) => {
    expect(axisKeysChanged(current, next)).toBe(true);
  });

  it("is false for no axes before and after", () => {
    expect(axisKeysChanged([], [])).toBe(false);
  });
});
