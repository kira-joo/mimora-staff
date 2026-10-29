import { describe, expect, it } from "vitest";
import { buildInviteLink } from "./invite-link";

describe("buildInviteLink", () => {
  it("points at the accept-invite page with the token", () => {
    expect(buildInviteLink("https://staff.example.com", "abc_DEF-123")).toBe("https://staff.example.com/accept-invite?token=abc_DEF-123");
  });
  it("encodes characters that would break the query", () => {
    expect(buildInviteLink("http://localhost:3417", "a b&c=d")).toBe("http://localhost:3417/accept-invite?token=a%20b%26c%3Dd");
  });
});
