import { describe, expect, it } from "vitest";
import { consentSummary } from "./consent-panel";

describe("consentSummary", () => {
  it("never asked is not consent", () => {
    expect(consentSummary({ granted: false })).toBe("Never asked — treated as no consent.");
  });
  it("says what happened and where", () => {
    expect(consentSummary({ granted: true, at: "2026-01-01T00:00:00Z", source: "signup" })).toBe("Agreed at signup");
    expect(consentSummary({ granted: false, at: "2026-01-01T00:00:00Z", source: "account" })).toBe("Withdrawn in their account");
    expect(consentSummary({ granted: true, at: "2026-01-01T00:00:00Z", source: "checkout" })).toBe("Agreed at checkout");
  });
});
