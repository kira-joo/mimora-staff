import { describe, expect, it } from "vitest";
import { maskRecipient, recipientDomain } from "./recipient";

describe("maskRecipient", () => {
  it("keeps the first character and the domain of an email address", () => {
    expect(maskRecipient("customer@example.com")).toBe("c***@example.com");
  });
  it("keeps only the ends of a phone number", () => {
    expect(maskRecipient("+201012345678")).toBe("+2***78");
  });
  it("never reveals a very short value, and never throws on an empty one", () => {
    expect(maskRecipient("1234")).toBe("***");
    expect(maskRecipient("")).toBe("(none)");
    expect(maskRecipient(undefined as unknown as string)).toBe("(none)");
  });
});

describe("recipientDomain", () => {
  it("is the lower-cased part after the last @", () => {
    expect(recipientDomain("Customer@Example.COM")).toBe("example.com");
  });
  it("is (unknown) for anything that is not an address", () => {
    expect(recipientDomain("+201012345678")).toBe("(unknown)");
    expect(recipientDomain("broken@")).toBe("(unknown)");
  });
});
