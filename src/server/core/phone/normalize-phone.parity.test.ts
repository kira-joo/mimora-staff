import { describe, expect, it } from "vitest";
import { normalizePhone as scriptNormalize } from "../../../../scripts/migrations/phone-normalization.mjs";
import { normalizePhone } from "./normalize-phone";

/** The migration report script carries a copy of the normaliser; this fails the build if the two ever disagree. */
describe("migration script normaliser parity", () => {
  const inputs = ["01012345678", "+20 101 234 5678", "٠١٠١٢٣٤٥٦٧٨", "۰۱۰۱۲۳۴۵۶۷۸", "00201012345678", "1012345678", "201012345678", "abc", "0", "012", "0512345678", "(0101) 234-5678", "‎+20 101‏2345678", ""];
  for (const cc of [undefined, "20", "966", "+20", "0"]) {
    it(`agrees for country code ${String(cc)}`, () => {
      for (const input of inputs) expect(scriptNormalize(input, cc), input).toBe(normalizePhone(input, cc));
    });
  }
});
