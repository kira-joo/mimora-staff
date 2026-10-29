import { describe, expect, it } from "vitest";
import { instantToWall, wallToInstant, type StoreDateTimeFormatter } from "./store-wall-clock";

const formatterFor = (timeZone: string): StoreDateTimeFormatter => {
  const dates = new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return (iso) => dates.format(new Date(iso));
};
const cairo = formatterFor("Africa/Cairo");

describe("store wall clock", () => {
  it("reads an instant as the store's clock (Cairo is UTC+3 in summer)", () => expect(instantToWall("2026-07-01T09:30:00.000Z", cairo)).toBe("2026-07-01T12:30"));
  it("uses the winter offset in winter (UTC+2)", () => expect(instantToWall("2026-01-15T09:30:00.000Z", cairo)).toBe("2026-01-15T11:30"));
  it("turns a store wall time into the right instant", () => expect(wallToInstant("2026-07-01T12:30", cairo)).toBe("2026-07-01T09:30:00.000Z"));
  it("round-trips across the year", () => {
    for (const wall of ["2026-01-01T00:00", "2026-03-31T23:59", "2026-06-15T08:05", "2026-12-31T23:30"]) {
      expect(instantToWall(wallToInstant(wall, cairo), cairo)).toBe(wall);
    }
  });
  it("does not depend on the formatter's zone being the runner's", () => {
    expect(wallToInstant("2026-07-01T12:30", formatterFor("America/New_York"))).toBe("2026-07-01T16:30:00.000Z");
  });
  it("returns empty for empty or malformed input", () => {
    expect(instantToWall(undefined, cairo)).toBe("");
    expect(instantToWall("nope", cairo)).toBe("");
    expect(wallToInstant("", cairo)).toBe("");
    expect(wallToInstant("2026-07-01", cairo)).toBe("");
  });
  it("returns empty when the formatter output is unreadable", () => expect(wallToInstant("2026-07-01T12:30", () => "??")).toBe(""));
});
