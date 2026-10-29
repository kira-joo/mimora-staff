import { describe, expect, it } from "vitest";
import { resolvePurchasability } from "./resolve-purchasability";
import type { PurchasabilityInput } from "./purchasability.types";

function input(overrides: Partial<PurchasabilityInput> = {}): PurchasabilityInput {
  return {
    productLifecycle: "published",
    discontinued: false,
    stock: 10,
    backorderPolicy: "DENY",
    ...overrides,
  };
}

describe("the happy path", () => {
  it("is purchasable when published, not discontinued, and in stock", () => {
    expect(resolvePurchasability(input())).toEqual({ purchasable: true });
  });

  it("defaults the requested quantity to 1", () => {
    expect(resolvePurchasability(input({ stock: 1 }))).toEqual({ purchasable: true });
  });
});

describe("structural gates, checked before stock", () => {
  it("refuses a draft product", () => {
    expect(resolvePurchasability(input({ productLifecycle: "draft" }))).toEqual({
      purchasable: false,
      reason: "NOT_PUBLISHED",
    });
  });

  it("refuses an archived product", () => {
    expect(resolvePurchasability(input({ productLifecycle: "archived" }))).toEqual({
      purchasable: false,
      reason: "NOT_PUBLISHED",
    });
  });

  it("refuses a discontinued variant regardless of stock", () => {
    expect(resolvePurchasability(input({ discontinued: true, stock: 999 }))).toEqual({
      purchasable: false,
      reason: "DISCONTINUED",
    });
  });

  it("a draft product with a discontinued variant still reports NOT_PUBLISHED first", () => {
    // The most actionable single reason, not a list.
    expect(resolvePurchasability(input({ productLifecycle: "draft", discontinued: true }))).toEqual({
      purchasable: false,
      reason: "NOT_PUBLISHED",
    });
  });
});

describe("stock and backorder policy", () => {
  it("refuses when stock is below the requested quantity", () => {
    expect(resolvePurchasability(input({ stock: 2, requestedQuantity: 3 }))).toEqual({
      purchasable: false,
      reason: "INSUFFICIENT_STOCK",
    });
  });

  it("refuses at exactly zero stock", () => {
    expect(resolvePurchasability(input({ stock: 0 }))).toEqual({
      purchasable: false,
      reason: "INSUFFICIENT_STOCK",
    });
  });

  it("allows exactly the remaining stock", () => {
    expect(resolvePurchasability(input({ stock: 3, requestedQuantity: 3 }))).toEqual({ purchasable: true });
  });

  it("CONTINUE_SELLING ignores stock entirely, including zero and negative", () => {
    expect(resolvePurchasability(input({ stock: 0, backorderPolicy: "CONTINUE_SELLING" }))).toEqual({
      purchasable: true,
    });
    expect(
      resolvePurchasability(input({ stock: -5, backorderPolicy: "CONTINUE_SELLING", requestedQuantity: 100 }))
    ).toEqual({ purchasable: true });
  });

  it("CONTINUE_SELLING does not override a discontinued or unpublished variant", () => {
    expect(
      resolvePurchasability(input({ backorderPolicy: "CONTINUE_SELLING", discontinued: true }))
    ).toMatchObject({ reason: "DISCONTINUED" });
    expect(
      resolvePurchasability(input({ backorderPolicy: "CONTINUE_SELLING", productLifecycle: "draft" }))
    ).toMatchObject({ reason: "NOT_PUBLISHED" });
  });
});
