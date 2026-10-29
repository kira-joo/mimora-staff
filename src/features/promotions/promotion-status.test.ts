import { describe, expect, it } from "vitest";
import { promotionStatus } from "./promotion-status";

const NOW = new Date("2026-10-02T12:00:00Z");
const base = { active: true, usageCount: 0, limits: {}, conditions: {} as { startsAt?: string; endsAt?: string } };

describe("promotionStatus", () => {
  it("is active with no window and no limit", () => expect(promotionStatus(base, NOW)).toBe("active"));
  it("is disabled when inactive, whatever the dates", () =>
    expect(promotionStatus({ ...base, active: false, conditions: { endsAt: "2020-01-01T00:00:00Z" } }, NOW)).toBe("disabled"));
  it("is scheduled before startsAt", () => expect(promotionStatus({ ...base, conditions: { startsAt: "2026-10-03T00:00:00Z" } }, NOW)).toBe("scheduled"));
  it("is active from startsAt exactly (engine rejects only now < startsAt)", () =>
    expect(promotionStatus({ ...base, conditions: { startsAt: NOW.toISOString() } }, NOW)).toBe("active"));
  it("is expired after endsAt", () => expect(promotionStatus({ ...base, conditions: { endsAt: "2026-10-01T00:00:00Z" } }, NOW)).toBe("expired"));
  it("is active at endsAt exactly (engine rejects only now > endsAt)", () =>
    expect(promotionStatus({ ...base, conditions: { endsAt: NOW.toISOString() } }, NOW)).toBe("active"));
  it("is exhausted once usage reaches the total limit", () => {
    expect(promotionStatus({ ...base, usageCount: 5, limits: { totalUses: 5 } }, NOW)).toBe("exhausted");
    expect(promotionStatus({ ...base, usageCount: 4, limits: { totalUses: 5 } }, NOW)).toBe("active");
  });
  it("copes with a promotion that has no limits object", () => expect(promotionStatus({ active: true, usageCount: 3, conditions: {} }, NOW)).toBe("active"));
  it("treats a null limit as unlimited", () => expect(promotionStatus({ ...base, usageCount: 9, limits: { totalUses: null as unknown as undefined } }, NOW)).toBe("active"));
  it("reports scheduled before exhausted, as the engine orders them", () =>
    expect(promotionStatus({ ...base, usageCount: 9, limits: { totalUses: 1 }, conditions: { startsAt: "2026-11-01T00:00:00Z" } }, NOW)).toBe("scheduled"));
});
