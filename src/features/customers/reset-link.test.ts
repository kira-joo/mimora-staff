import { describe, expect, it } from "vitest";
import { resetLinkText } from "./reset-link";

describe("resetLinkText", () => {
  it("prefers the full URL and falls back to the path", () => {
    expect(resetLinkText({ resetUrl: "https://shop.example/reset-password?token=abc", resetPath: "/reset-password?token=abc" })).toBe("https://shop.example/reset-password?token=abc");
    expect(resetLinkText({ resetPath: "/reset-password?token=abc" })).toBe("/reset-password?token=abc");
  });
});
