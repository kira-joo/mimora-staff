import { describe, expect, it } from "vitest";
import { cleanUpCounts, cleanUpSummary } from "./clean-up-summary";

const result = (examined: number, kept: number, destroyed: number, failed: number) => ({
  examined,
  kept,
  destroyed: Array.from({ length: destroyed }, (_, i) => `mimora/store/products/d${i}`),
  failed: Array.from({ length: failed }, (_, i) => `mimora/store/products/f${i}`),
});

describe("cleanUpCounts", () => {
  it("shows Checked, Kept, Deleted and Failed, in that order", () => {
    expect(cleanUpCounts(result(7, 3, 2, 2))).toEqual([
      { label: "Checked", value: 7 },
      { label: "Kept", value: 3 },
      { label: "Deleted", value: 2 },
      { label: "Failed", value: 2 },
    ]);
  });
});

describe("cleanUpSummary", () => {
  it("says plainly when nothing was old enough to check", () => {
    expect(cleanUpSummary(result(0, 0, 0, 0))).toEqual({ tone: "success", message: "No uploads older than 24 hours were waiting to be checked." });
  });

  it("checked but everything was in use", () => {
    expect(cleanUpSummary(result(2, 2, 0, 0))).toEqual({ tone: "success", message: "No unused images were found." });
  });

  it("counts deletions, singular and plural", () => {
    expect(cleanUpSummary(result(1, 0, 1, 0)).message).toBe("Deleted 1 unused image.");
    expect(cleanUpSummary(result(3, 0, 3, 0)).message).toBe("Deleted 3 unused images.");
  });

  it("a failure is a warning that says the next run retries", () => {
    expect(cleanUpSummary(result(3, 0, 2, 1))).toEqual({ tone: "warning", message: "Deleted 2 unused images. 1 could not be deleted — run it again to retry." });
  });
});
