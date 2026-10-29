import { describe, expect, it } from "vitest";
import { ageOf } from "./payment-ageing";

const now = new Date("2026-10-02T12:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

describe("ageOf — the report's own bands", () => {
  it.each([
    [0.5, "UNDER_24H", "neutral", "Under an hour"],
    [23.9, "UNDER_24H", "neutral", "23 h"],
    [24, "24H_TO_48H", "pending", "24 h"],
    [47.9, "24H_TO_48H", "pending", "47 h"],
    [48, "OVER_48H", "danger", "2 days"],
    [100, "OVER_48H", "danger", "4 days"],
  ])("%s hours → %s", (hours, band, tone, label) => {
    expect(ageOf(ago(hours), now)).toMatchObject({ band, tone, label });
  });

  it("never reports a negative wait", () => {
    expect(ageOf(ago(-2), now).hours).toBe(0);
  });
});
