import { describe, expect, it } from "vitest";
import { REDACTED, isSensitiveKey, keyWords, redact } from "./redact";

describe("keyWords", () => {
  it.each([
    ["passwordResetTokenHash", ["password", "reset", "token", "hash"]],
    ["refresh_token", ["refresh", "token"]],
    ["x-api-TOKEN", ["x", "api", "token"]],
    ["OTPCode", ["otp", "code"]],
    ["shippingFeeMode", ["shipping", "fee", "mode"]],
  ])("%s → %j", (key, words) => expect(keyWords(key)).toEqual(words));
});

describe("isSensitiveKey — real secrets stay redacted", () => {
  it.each([
    // Every secret-bearing field the app's DTOs actually carry.
    "password",
    "newPassword",
    "oldPassword",
    "token",
    // Common credential shapes.
    "accessToken",
    "refresh_token",
    "x-api-token",
    "resetTokens",
    "passwordHash",
    "passwordResetTokenHash",
    "tokenHash",
    "clientSecret",
    "SECRET",
    "otp",
    "otpCode",
    "pin",
    "pinCode",
  ])("%s", (key) => expect(isSensitiveKey(key)).toBe(true));
});

describe("isSensitiveKey — names that merely contain those letters are not secrets", () => {
  it.each([
    // The false positives the substring rule produced in this app.
    "shippingFeeMode",
    "flatShippingFee",
    "tokenOverrides",
    // Same failure shape.
    "tokenVersion",
    "shipping",
    "spinner",
    "pinned",
    "hashtag",
    "pinnedProducts",
  ])("%s", (key) => expect(isSensitiveKey(key)).toBe(false));
});

describe("redact", () => {
  it("replaces secrets at any depth and in arrays, and leaves everything else as sent", () => {
    const body = {
      name: "Sara",
      password: "hunter2",
      nested: { refreshToken: "abc", note: "keep" },
      methods: [{ key: "INSTAPAY", pin: "1234", destination: "atlas@instapay" }],
    };
    expect(redact(body)).toEqual({
      name: "Sara",
      password: REDACTED,
      nested: { refreshToken: REDACTED, note: "keep" },
      methods: [{ key: "INSTAPAY", pin: REDACTED, destination: "atlas@instapay" }],
    });
  });

  it("records fulfilment shipping settings as sent", () => {
    expect(redact({ shippingFeeMode: "FLAT", flatShippingFee: "40.00", deliveryEnabled: true })).toEqual({ shippingFeeMode: "FLAT", flatShippingFee: "40.00", deliveryEnabled: true });
  });

  it("records theme tokenOverrides — brand colours the storefront serves publicly — as sent", () => {
    const theme = { defaultGround: "light", tokenOverrides: [{ key: "primary", value: "#6B8F71" }] };
    expect(redact({ theme })).toEqual({ theme });
  });

  it("still redacts a real secret even inside an object whose own name is harmless", () => {
    expect(redact({ tokenOverrides: [{ key: "primary", value: "#fff", accessToken: "leak" }] })).toEqual({ tokenOverrides: [{ key: "primary", value: "#fff", accessToken: REDACTED }] });
  });

  it("returns non-objects untouched", () => {
    expect(redact("plain")).toBe("plain");
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});
