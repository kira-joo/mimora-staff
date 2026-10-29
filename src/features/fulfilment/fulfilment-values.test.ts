import { describe, expect, it } from "vitest";
import {
  TIME_PATTERN,
  areasToText,
  fromExceptionsForm,
  fromWeekForm,
  parseAreas,
  toExceptionsForm,
  toWeekForm,
  validateExceptions,
  validateRanges,
  validateWeek,
  toOrderEntries,
} from "./fulfilment-values";

describe("TIME_PATTERN", () => {
  it.each(["00:00", "09:30", "23:59"])("accepts %s", (v) => expect(TIME_PATTERN.test(v)).toBe(true));
  it.each(["24:00", "9:30", "12:60", "", "12:5"])("rejects %j", (v) => expect(TIME_PATTERN.test(v)).toBe(false));
});

describe("areas", () => {
  it("trims, drops blanks and repeats, keeps Arabic and mixed lines", () => {
    expect(parseAreas("  مدينة نصر \n\nNasr City\r\nمدينة نصر\n حي المعادي Maadi ")).toEqual(["مدينة نصر", "Nasr City", "حي المعادي Maadi"]);
  });
  it("round-trips through text", () => {
    expect(parseAreas(areasToText(["a", "ب"]))).toEqual(["a", "ب"]);
    expect(areasToText(undefined)).toBe("");
  });
});

describe("toOrderEntries", () => {
  it("numbers the full list from zero", () => {
    expect(toOrderEntries(["x", "y", "z"])).toEqual([
      { id: "x", order: 0 },
      { id: "y", order: 1 },
      { id: "z", order: 2 },
    ]);
  });
  it("is empty for an empty list", () => expect(toOrderEntries([])).toEqual([]));
});

describe("validateRanges", () => {
  it("accepts a split day", () => expect(validateRanges([{ open: "09:00", close: "13:00" }, { open: "16:00", close: "21:00" }])).toBeUndefined());
  it("accepts no ranges", () => expect(validateRanges([])).toBeUndefined());
  it("refuses a missing end", () => expect(validateRanges([{ open: "09:00", close: "" }])).toMatch(/both/));
  it("accepts an overnight range — no backend rule orders the two times", () => {
    expect(validateRanges([{ open: "18:00", close: "02:00" }])).toBeUndefined();
  });
});

describe("week form", () => {
  it("expands to seven rows, Sunday first, missing days closed", () => {
    const week = toWeekForm([{ weekday: 2, ranges: [{ open: "09:00", close: "17:00" }] }]);
    expect(week).toHaveLength(7);
    expect(week.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(week[2].ranges).toHaveLength(1);
    expect(week[0].ranges).toEqual([]);
  });
  it("sends only open days", () => {
    const week = toWeekForm([{ weekday: 6, ranges: [{ open: "10:00", close: "14:00" }] }]);
    expect(fromWeekForm(week)).toEqual([{ weekday: 6, ranges: [{ open: "10:00", close: "14:00" }] }]);
  });
  it("names the weekday in a validation message", () => {
    const week = toWeekForm([{ weekday: 1, ranges: [{ open: "10:00", close: "" }] }]);
    expect(validateWeek(week)).toMatch(/^Monday:/);
  });
});

describe("exceptions form", () => {
  it("shows the date-only part of the stored instant and sorts", () => {
    const form = toExceptionsForm([
      { date: "2026-12-25T00:00:00.000Z", closed: true, ranges: [] },
      { date: "2026-01-01T00:00:00.000Z", closed: true, ranges: [] },
    ]);
    expect(form.map((e) => e.date)).toEqual(["2026-01-01", "2026-12-25"]);
  });
  it("drops ranges from a closed day on the way out", () => {
    expect(fromExceptionsForm([{ date: "2026-05-01", closed: true, ranges: [{ open: "09:00", close: "10:00" }] }])).toEqual([{ date: "2026-05-01", closed: true, ranges: [] }]);
  });
  it("refuses a missing or repeated date and an open day with no hours", () => {
    expect(validateExceptions([{ date: "", closed: true, ranges: [] }])).toMatch(/date/);
    expect(validateExceptions([{ date: "2026-05-01", closed: true, ranges: [] }, { date: "2026-05-01", closed: true, ranges: [] }])).toMatch(/more than once/);
    expect(validateExceptions([{ date: "2026-05-01", closed: false, ranges: [] }])).toMatch(/add opening hours/);
    expect(validateExceptions([{ date: "2026-05-01", closed: false, ranges: [{ open: "09:00", close: "12:00" }] }])).toBeUndefined();
  });
});
