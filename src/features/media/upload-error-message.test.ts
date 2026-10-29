import { describe, expect, it } from "vitest";
import { uploadErrorMessage } from "./upload-error-message";

const FALLBACK = "The upload failed. Try again.";

describe("uploadErrorMessage", () => {
  it("shows the server's message from a plain ApiError object (not an Error instance)", () => {
    const apiError = { message: "This store cannot accept file uploads right now. Please try again later or contact the store.", statusCode: 503 };
    expect(apiError instanceof Error).toBe(false);
    expect(uploadErrorMessage(apiError, FALLBACK)).toBe(apiError.message);
  });

  it("shows a 400 validation message", () => {
    expect(uploadErrorMessage({ message: "The image must be at least 600 × 315 pixels.", statusCode: 400 }, FALLBACK)).toBe("The image must be at least 600 × 315 pixels.");
  });

  it("still shows a real Error's message", () => {
    expect(uploadErrorMessage(new Error("boom"), FALLBACK)).toBe("boom");
  });

  it("falls back for an empty message and for values that carry none", () => {
    expect(uploadErrorMessage({ message: "  ", statusCode: 500 }, FALLBACK)).toBe(FALLBACK);
    expect(uploadErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(uploadErrorMessage("nope", FALLBACK)).toBe(FALLBACK);
    expect(uploadErrorMessage({ status: 500 }, FALLBACK)).toBe(FALLBACK);
  });
});
