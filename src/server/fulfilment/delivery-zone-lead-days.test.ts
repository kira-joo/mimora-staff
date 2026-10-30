import { describe, expect, it } from "vitest";
import { leadDaysRangeProblems } from "./delivery-zone-lead-days";

describe("leadDaysRangeProblems", () => {
  it("accepts no earliest estimate, an earlier one, and an equal one", () => {
    expect(leadDaysRangeProblems(undefined, 5)).toEqual([]);
    expect(leadDaysRangeProblems(null, 5)).toEqual([]);
    expect(leadDaysRangeProblems(3, 5)).toEqual([]);
    expect(leadDaysRangeProblems(5, 5)).toEqual([]);
  });

  it("refuses an earliest estimate later than the latest, on the leadDaysMin field", () => {
    expect(leadDaysRangeProblems(6, 5)).toEqual([{ field: "leadDaysMin", messages: [expect.stringContaining("cannot be later")] }]);
  });
});
