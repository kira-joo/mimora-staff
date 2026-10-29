import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./api-error-message";

describe("authErrorMessage", () => {
  it("passes the server's own message through (one message for every sign-in failure)", () => {
    expect(authErrorMessage({ statusCode: 401, message: "Invalid email or password." }, "fallback")).toBe("Invalid email or password.");
  });

  it("explains rate limiting and network failure in plain words", () => {
    expect(authErrorMessage({ statusCode: 429, message: "x" }, "fallback")).toMatch(/Too many attempts/);
    expect(authErrorMessage({ message: "Network error" }, "fallback")).toMatch(/Can't reach the server/);
  });

  it("reads a status-less error as a network failure — what a failed fetch throws", () => {
    expect(authErrorMessage(new TypeError("Failed to fetch"), "fallback")).toMatch(/Can't reach the server/);
  });

  it("falls back for anything that isn't an error object", () => {
    expect(authErrorMessage("nope", "fallback")).toBe("fallback");
  });
});
