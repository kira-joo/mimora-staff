/**
 * The two payment-settings clocks that used to do nothing
 * (`PaymentSettings.methods[].autoCancelMinutes` / `verificationWindowMinutes`),
 * as pure functions — the decision, separate from the sweep that applies it.
 *
 * A value that is absent, zero, negative or not finite means the clock is OFF
 * for that method: a method with no `autoCancelMinutes` never auto-cancels, and
 * `0` is "off", not "cancel immediately" (the settings screen leaves the field
 * blank to switch it off).
 */

/** The configured minutes as a usable positive duration, or `undefined` when the clock is off. */
export function activeWindowMinutes(minutes: number | undefined): number | undefined {
  return minutes !== undefined && Number.isFinite(minutes) && minutes > 0 ? minutes : undefined;
}

/**
 * The instant an order placed exactly `autoCancelMinutes` ago was placed. An order is expired when it is STRICTLY
 * older than the window — `placedAt < cutoff` — so that boundary order is not yet expired and the next millisecond
 * tips it over. The sweep queries with the same comparison, so the pure rule and the database never disagree.
 */
export function unpaidExpiryCutoff(now: Date, autoCancelMinutes: number): Date {
  return new Date(now.getTime() - autoCancelMinutes * 60_000);
}

/** Whether an order still awaiting payment has waited longer than its method's `autoCancelMinutes`. */
export function isUnpaidExpired(input: { placedAt: Date; now: Date; autoCancelMinutes: number | undefined }): boolean {
  const minutes = activeWindowMinutes(input.autoCancelMinutes);
  if (minutes === undefined) return false;
  return input.placedAt.getTime() < unpaidExpiryCutoff(input.now, minutes).getTime();
}

/**
 * Whether a submitted proof has waited longer than the method's `verificationWindowMinutes` for a decision. Display
 * and triage only — nothing acts on it; staff decide.
 */
export function isVerificationOverdue(input: { submittedAt: Date; now: Date; verificationWindowMinutes: number | undefined }): boolean {
  const minutes = activeWindowMinutes(input.verificationWindowMinutes);
  if (minutes === undefined) return false;
  return input.submittedAt.getTime() < input.now.getTime() - minutes * 60_000;
}
