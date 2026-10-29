import { describe, expect, it } from "vitest";
import { phoneCountryMismatch } from "./store-phone-country";

describe("phoneCountryMismatch", () => {
  it("agrees for each fixture merchant's real country (Hirfa: Egypt, Qahwa & Co: Saudi Arabia)", () => {
    expect(phoneCountryMismatch("20", "+20 100 555 0142")).toBeNull();
    expect(phoneCountryMismatch("966", "+966 11 555 0188")).toBeNull();
  });

  it("flags the wrong country, naming both sides", () => {
    expect(phoneCountryMismatch("20", "+966 11 555 0188")).toMatch(/is 20, but .*\+966/);
    expect(phoneCountryMismatch("966", "+20 100 555 0142")).toMatch(/is 966, but .*\+20/);
  });

  it("flags an unset code when the store's own number shows its country", () => {
    expect(phoneCountryMismatch(undefined, "+20 100 555 0142")).toMatch(/not set/);
  });

  it("cannot judge without an international contact number", () => {
    expect(phoneCountryMismatch("20", undefined)).toBeNull();
    expect(phoneCountryMismatch("20", "0100 555 0142")).toBeNull();
  });

  it("compares by prefix, which is sound because country calling codes are prefix-free (ITU E.164) — an unassigned prefix like 2 is not caught", () => {
    expect(phoneCountryMismatch("2", "+20 100 555 0142")).toBeNull();
  });
});
