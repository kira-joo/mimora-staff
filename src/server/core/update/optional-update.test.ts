import { describe, expect, it } from "vitest";
import { BadRequestError } from "@kira-joo/backend-toolkit-core";
import { mapPresent, mergeOptional, toUpdateOperators } from "./optional-update";

describe("mergeOptional — omitted keeps, null clears, a value sets", () => {
  const stored = { totalUses: 100, perCustomerUses: 1 };

  it("leaves a key the patch omits", () => {
    expect(mergeOptional(stored, { perCustomerUses: 3 })).toEqual({ totalUses: 100, perCustomerUses: 3 });
  });

  it("removes a key the patch sets to null", () => {
    const next = mergeOptional(stored, { totalUses: null });
    expect(next).toEqual({ perCustomerUses: 1 });
    expect("totalUses" in next).toBe(false);
  });

  it("treats an explicit undefined as omitted", () => {
    expect(mergeOptional(stored, { totalUses: undefined })).toEqual(stored);
  });

  it("keeps zero and false as values, not absence", () => {
    expect(mergeOptional<{ count?: number; on?: boolean }>({ count: 5, on: true }, { count: 0, on: false })).toEqual({ count: 0, on: false });
  });

  it("works from nothing stored, and never mutates the stored object", () => {
    expect(mergeOptional<{ a?: number }>(undefined, { a: 1 })).toEqual({ a: 1 });
    mergeOptional(stored, { totalUses: null });
    expect(stored).toEqual({ totalUses: 100, perCustomerUses: 1 });
  });
});

describe("toUpdateOperators", () => {
  it("sets values, unsets cleared clearable keys, and leaves omitted ones out", () => {
    expect(toUpdateOperators({ fee: "10", minimumOrder: null, active: undefined }, ["minimumOrder"])).toEqual({ $set: { fee: "10" }, $unset: { minimumOrder: "" } });
  });

  it("emits no $unset when nothing is cleared", () => {
    expect(toUpdateOperators({ fee: "10" }, ["minimumOrder"])).toEqual({ $set: { fee: "10" } });
  });

  it("keeps zero, false and an empty string as values", () => {
    expect(toUpdateOperators({ count: 0, on: false, note: "" }, [])).toEqual({ $set: { count: 0, on: false, note: "" } });
  });

  it("refuses to clear a key that is not clearable", () => {
    expect(() => toUpdateOperators({ fee: null }, ["minimumOrder"])).toThrow(BadRequestError);
  });
});

describe("mapPresent", () => {
  it("converts a value and passes undefined and null through", () => {
    expect(mapPresent("2", Number)).toBe(2);
    expect(mapPresent<string, number>(undefined, Number)).toBeUndefined();
    expect(mapPresent<string, number>(null, Number)).toBeNull();
  });
});
