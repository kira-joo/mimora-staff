import { describe, expect, it } from "vitest";
import { cleanPhone, isValidCanonicalPhone, isValidCountryCallingCode, normalizePhone, phoneLookupVariants } from "./normalize-phone";

describe("normalizePhone", () => {
  it("maps Arabic-Indic digits to Latin", () => {
    expect(normalizePhone("٠١٠١٢٣٤٥٦٧٨", "20")).toBe("+201012345678");
    expect(normalizePhone("٠١٠١٢٣٤٥٦٧٨")).toBe("01012345678");
  });
  it("maps Extended Arabic-Indic (Persian/Urdu) digits to Latin", () => {
    expect(normalizePhone("۰۱۰۱۲۳۴۵۶۷۸", "20")).toBe("+201012345678");
  });
  it("handles every digit of both ranges", () => {
    expect(cleanPhone("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(cleanPhone("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
  });
  it("strips spaces, dashes, dots, parentheses, NBSP and bidi marks", () => {
    expect(normalizePhone("+20 (101) 234-5678")).toBe("+201012345678");
    expect(normalizePhone("0101.234.5678", "20")).toBe("+201012345678");
    expect(normalizePhone("‎+20 101‏2345678")).toBe("+201012345678");
  });
  it("turns a 00 prefix into +", () => {
    expect(normalizePhone("00201012345678")).toBe("+201012345678");
    expect(normalizePhone("00 20 101 234 5678", "966")).toBe("+201012345678");
  });
  it("keeps a leading + untouched and never applies the default country to it", () => {
    expect(normalizePhone("+966512345678", "20")).toBe("+966512345678");
  });
  it("converts a trunk-0 national number only when a country code is configured", () => {
    expect(normalizePhone("01012345678", "20")).toBe("+201012345678");
    expect(normalizePhone("0512345678", "966")).toBe("+966512345678");
    expect(normalizePhone("01012345678")).toBe("01012345678");
    expect(normalizePhone("01012345678", "")).toBe("01012345678");
  });
  it("never guesses: no trunk 0 means no conversion", () => {
    expect(normalizePhone("1012345678", "20")).toBe("1012345678");
    expect(normalizePhone("201012345678", "20")).toBe("201012345678");
  });
  it("ignores a malformed configured country code", () => {
    expect(normalizePhone("01012345678", "+20")).toBe("01012345678");
    expect(normalizePhone("01012345678", "0")).toBe("01012345678");
    expect(normalizePhone("01012345678", "2000")).toBe("01012345678");
  });
  it("is idempotent", () => {
    for (const raw of ["01012345678", "+20 101 234 5678", "٠١٠١٢٣٤٥٦٧٨", "0020 1012345678", "12345"]) {
      const once = normalizePhone(raw, "20");
      expect(normalizePhone(once, "20")).toBe(once);
    }
  });
  it("returns garbage cleaned but unchanged, for validation to reject", () => {
    expect(normalizePhone("abc123", "20")).toBe("abc123");
    expect(isValidCanonicalPhone(normalizePhone("0101abc5678", "20"))).toBe(false);
  });
  it("does not convert a trunk-0 number whose E.164 form would be malformed", () => {
    expect(normalizePhone("012", "20")).toBe("012");
    expect(normalizePhone("0", "20")).toBe("0");
  });
});

describe("isValidCanonicalPhone", () => {
  it("accepts E.164 with 8-15 digits after +", () => {
    expect(isValidCanonicalPhone("+12345678")).toBe(true);
    expect(isValidCanonicalPhone("+123456789012345")).toBe(true);
  });
  it("rejects E.164 outside 8-15 digits, with a leading 0, or with junk", () => {
    expect(isValidCanonicalPhone("+1234567")).toBe(false);
    expect(isValidCanonicalPhone("+1234567890123456")).toBe(false);
    expect(isValidCanonicalPhone("+0123456789")).toBe(false);
    expect(isValidCanonicalPhone("+20abc12345678")).toBe(false);
  });
  it("accepts 5-15 digit national numbers and rejects others", () => {
    expect(isValidCanonicalPhone("01012345678")).toBe(true);
    expect(isValidCanonicalPhone("1234")).toBe(false);
    expect(isValidCanonicalPhone("1234567890123456")).toBe(false);
    expect(isValidCanonicalPhone("abc")).toBe(false);
    expect(isValidCanonicalPhone("")).toBe(false);
  });
});

describe("isValidCountryCallingCode", () => {
  it("is 1-3 digits without a leading zero", () => {
    expect(["1", "20", "966"].every(isValidCountryCallingCode)).toBe(true);
    expect(["", "0", "+20", "2000", "ab", "20 "].some(isValidCountryCallingCode)).toBe(false);
  });
});

describe("phoneLookupVariants", () => {
  it("lists the canonical form first, then the forms an older record may use", () => {
    const variants = phoneLookupVariants("+20 101 234 5678", "20");
    expect(variants[0]).toBe("+201012345678");
    expect(variants).toEqual(expect.arrayContaining(["201012345678", "00201012345678", "01012345678", "+20 101 234 5678"]));
  });
  it("derives the national form from a national input too", () => {
    expect(phoneLookupVariants("0101 234 5678", "20")).toEqual(expect.arrayContaining(["+201012345678", "01012345678", "0101 234 5678"]));
  });
  it("without a configured country adds no national form (never guesses)", () => {
    const variants = phoneLookupVariants("+201012345678");
    expect(variants).toEqual(expect.arrayContaining(["+201012345678", "201012345678", "00201012345678"]));
    expect(variants).not.toContain("01012345678");
  });
  it("is deduplicated and has no empty entry", () => {
    const variants = phoneLookupVariants("01012345678");
    expect(new Set(variants).size).toBe(variants.length);
    expect(variants).not.toContain("");
  });
});

describe("each fixture store's country: every way a customer types one number is one account", () => {
  it.each([
    ["Hirfa (Egypt, STORE_PHONE_COUNTRY_CODE=20)", "20", "+201012345678", ["01012345678", "010 1234 5678", "+20 101 234 5678", "00201012345678", "٠١٠١٢٣٤٥٦٧٨", "(010) 1234-5678"]],
    ["Qahwa & Co (Saudi Arabia, STORE_PHONE_COUNTRY_CODE=966)", "966", "+966512345678", ["0512345678", "051 234 5678", "+966 51 234 5678", "00966512345678", "٠٥١٢٣٤٥٦٧٨", "05-1234-5678"]],
  ])("%s", (_store, cc, canonical, forms) => {
    for (const form of forms) expect(normalizePhone(form, cc)).toBe(canonical);
  });
});
