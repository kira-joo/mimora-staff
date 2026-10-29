import { beforeAll, describe, expect, it } from "vitest";
import { deriveOrderAccessToken, isValidOrderAccessToken } from "./order-access-token";

const ID_A = "65f0000000000000000000a1";
const ID_B = "65f0000000000000000000b2";

beforeAll(() => {
  process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
});

describe("order access token", () => {
  it("is stable for an order and differs per order", () => {
    expect(deriveOrderAccessToken(ID_A)).toBe(deriveOrderAccessToken(ID_A));
    expect(deriveOrderAccessToken(ID_A)).not.toBe(deriveOrderAccessToken(ID_B));
  });

  it("is a 43-char base64url string (SHA-256 digest), safe in a header", () => {
    expect(deriveOrderAccessToken(ID_A)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("accepts its own token and rejects another order's, a tampered one, empty and absent", () => {
    const token = deriveOrderAccessToken(ID_A);
    expect(isValidOrderAccessToken(ID_A, token)).toBe(true);
    expect(isValidOrderAccessToken(ID_A, deriveOrderAccessToken(ID_B))).toBe(false);
    expect(isValidOrderAccessToken(ID_A, `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`)).toBe(false);
    expect(isValidOrderAccessToken(ID_A, "")).toBe(false);
    expect(isValidOrderAccessToken(ID_A, null)).toBe(false);
    expect(isValidOrderAccessToken(ID_A, undefined)).toBe(false);
  });

  it("does not throw on a wrong-length presented value", () => {
    expect(isValidOrderAccessToken(ID_A, "short")).toBe(false);
    expect(isValidOrderAccessToken(ID_A, `${deriveOrderAccessToken(ID_A)}extra`)).toBe(false);
  });

  it("depends on the secret: the same order yields a different token under another secret", () => {
    const original = process.env.CUSTOMER_JWT_SECRET;
    const before = deriveOrderAccessToken(ID_A);
    process.env.CUSTOMER_JWT_SECRET = "a-completely-different-secret-of-sufficient-length";
    try {
      expect(deriveOrderAccessToken(ID_A)).not.toBe(before);
    } finally {
      process.env.CUSTOMER_JWT_SECRET = original;
    }
  });
});
