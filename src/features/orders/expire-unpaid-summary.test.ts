import { describe, expect, it } from "vitest";
import { expireUnpaidSummary } from "./expire-unpaid-summary";

const result = (patch: Partial<Parameters<typeof expireUnpaidSummary>[0]> = {}) => ({ cancelled: [], skipped: 0, failed: [], methodsSwept: ["WALLET_TRANSFER"], ...patch });

describe("expireUnpaidSummary", () => {
  it("says the sweep is OFF when no method has an auto-cancel time — not '0 cancelled'", () => {
    const summary = expireUnpaidSummary(result({ methodsSwept: [] }));
    expect(summary.tone).toBe("warning");
    expect(summary.message).toMatch(/nothing was checked/i);
  });

  it("reports nothing overdue as a success", () => {
    expect(expireUnpaidSummary(result())).toEqual({ tone: "success", message: "No unpaid orders were past their deadline." });
  });

  it("counts cancellations, singular and plural", () => {
    expect(expireUnpaidSummary(result({ cancelled: ["A"] })).message).toBe("Cancelled 1 unpaid order.");
    expect(expireUnpaidSummary(result({ cancelled: ["A", "B"] })).message).toBe("Cancelled 2 unpaid orders.");
  });

  it("warns when some cancellations failed", () => {
    const summary = expireUnpaidSummary(result({ cancelled: ["A"], failed: [{ orderNumber: "B", message: "x" }] }));
    expect(summary.tone).toBe("warning");
    expect(summary.message).toMatch(/1 could not be cancelled/);
  });
});
