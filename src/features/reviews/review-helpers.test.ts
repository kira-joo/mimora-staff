import { describe, expect, it } from "vitest";
import { moderationOptions, ratingLabel, rejectConsequence } from "./review-helpers";

describe("moderationOptions", () => {
  it("offers both for a pending review", () => expect(moderationOptions("PENDING")).toEqual({ approve: true, reject: true }));
  it("offers only reject once approved", () => expect(moderationOptions("APPROVED")).toEqual({ approve: false, reject: true }));
  it("offers only approve once rejected", () => expect(moderationOptions("REJECTED")).toEqual({ approve: true, reject: false }));
});

describe("rejectConsequence", () => {
  it("mentions the rating for an approved review", () => expect(rejectConsequence("APPROVED")).toMatch(/rating/));
  it("does not for a pending one", () => expect(rejectConsequence("PENDING")).not.toMatch(/rating/));
});

describe("ratingLabel", () => {
  it("reads out of five", () => expect(ratingLabel({ rating: 4 })).toBe("4 / 5"));
});
