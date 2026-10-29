import { describe, expect, it } from "vitest";
import { activeWindowMinutes, isUnpaidExpired, isVerificationOverdue, unpaidExpiryCutoff } from "./unpaid-expiry";

const now = new Date("2026-10-23T12:00:00.000Z");
const minutesAgo = (minutes: number, extraMs = 0) => new Date(now.getTime() - minutes * 60_000 - extraMs);

describe("activeWindowMinutes", () => {
  it.each([undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY])("treats %s as the clock being off", (value) => {
    expect(activeWindowMinutes(value)).toBeUndefined();
  });

  it("passes a positive duration through", () => {
    expect(activeWindowMinutes(90)).toBe(90);
  });
});

describe("isUnpaidExpired — strictly older than the window", () => {
  it("is not expired exactly at the boundary", () => {
    expect(isUnpaidExpired({ placedAt: minutesAgo(60), now, autoCancelMinutes: 60 })).toBe(false);
  });

  it("is expired one millisecond past the boundary", () => {
    expect(isUnpaidExpired({ placedAt: minutesAgo(60, 1), now, autoCancelMinutes: 60 })).toBe(true);
  });

  it("is not expired inside the window", () => {
    expect(isUnpaidExpired({ placedAt: minutesAgo(10), now, autoCancelMinutes: 60 })).toBe(false);
  });

  it("never expires when the method has no (or a zero) autoCancelMinutes", () => {
    expect(isUnpaidExpired({ placedAt: minutesAgo(100_000), now, autoCancelMinutes: undefined })).toBe(false);
    expect(isUnpaidExpired({ placedAt: minutesAgo(100_000), now, autoCancelMinutes: 0 })).toBe(false);
  });

  it("agrees with the cutoff the sweep queries by", () => {
    const cutoff = unpaidExpiryCutoff(now, 60);
    expect(cutoff.toISOString()).toBe("2026-10-23T11:00:00.000Z");
  });
});

describe("isVerificationOverdue", () => {
  it("flags a proof strictly older than the window, not one exactly at it", () => {
    expect(isVerificationOverdue({ submittedAt: minutesAgo(120), now, verificationWindowMinutes: 120 })).toBe(false);
    expect(isVerificationOverdue({ submittedAt: minutesAgo(120, 1), now, verificationWindowMinutes: 120 })).toBe(true);
  });

  it("is never overdue when the window is off", () => {
    expect(isVerificationOverdue({ submittedAt: minutesAgo(100_000), now, verificationWindowMinutes: undefined })).toBe(false);
    expect(isVerificationOverdue({ submittedAt: minutesAgo(100_000), now, verificationWindowMinutes: 0 })).toBe(false);
  });
});
