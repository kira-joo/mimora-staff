import { randomBytes } from "node:crypto";
import { DuplicateKeyError, UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import { mailConfigStatus } from "../core/mail/mail-config";
import { sendNewsletterConfirmationEmail } from "../core/mail/send-account-emails";
import { newsletterSubscriberRepository } from "../core/repositories";
import { runAfterResponse } from "../notifications/after-response";
import { hashVerificationToken } from "../shop/auth/hash-verification-token";
import { NEWSLETTER_CONFIRMATION_TTL_MS, NEWSLETTER_RESEND_AFTER_MS } from "./confirmation.constants";
import { NewsletterSubscriberModel, type NewsletterLocale, type NewsletterSource } from "./newsletter-subscriber.schema";
import { normalizeEmail } from "./normalize-email";

export interface RequestConfirmationInput {
  email: string;
  locale: NewsletterLocale;
  source: NewsletterSource;
}

/**
 * A PUBLIC newsletter request: anyone can type anyone's address, so it never subscribes
 * anyone — it records a `PENDING` row and, when mail is configured, emails the address a
 * single-use link. Only following that link (`confirmNewsletterSubscription`) consents.
 *
 * - **Mail configured:** a new address is created `PENDING` with a hashed, expiring token
 *   and one email is queued (after the response — `runAfterResponse`). A `PENDING` address
 *   asking again is re-issued a fresh token at most every {@link NEWSLETTER_RESEND_AFTER_MS}.
 * - **Mail OFF or half-configured:** nothing can be sent, so the row stays `PENDING` with no
 *   token. The console shows it as unconfirmed. Configure mail, and the address's next
 *   request re-issues a link.
 * - **Already `SUBSCRIBED` or `UNSUBSCRIBED`:** nothing changes and nothing is sent. An
 *   unsubscribed address is a suppression — the public form never overrides it.
 *
 * **Enumeration-safe by construction.** Returns nothing, never throws for any state, and the
 * route answers identically whatever happened; the only externally visible difference (an
 * email arriving) goes to the address's owner.
 */
export async function requestNewsletterConfirmation(input: RequestConfirmationInput, env: Record<string, string | undefined> = process.env): Promise<void> {
  const email = normalizeEmail(input.email);
  const now = new Date();
  const mailConfigured = mailConfigStatus(env).state === "configured";

  // Create-if-absent. A concurrent first request losing the unique-index race is "already pending", handled below.
  try {
    await newsletterSubscriberRepository.updateAtomic(
      { email },
      { $setOnInsert: { email, locale: input.locale, source: input.source, status: "PENDING" } },
      { upsert: true, skipThrowError: true }
    );
  } catch (error) {
    if (!(error instanceof DuplicateKeyError)) throw error;
  }

  if (!mailConfigured) return;

  // Issue a token only to a PENDING row that has none live, or whose last mail is old enough to repeat.
  const token = randomBytes(32).toString("base64url");
  const resendBefore = new Date(now.getTime() - NEWSLETTER_RESEND_AFTER_MS);
  const issued = await NewsletterSubscriberModel.findOneAndUpdate(
    { email, status: "PENDING", $or: [{ confirmationSentAt: { $exists: false } }, { confirmationSentAt: { $lte: resendBefore } }] },
    { $set: { confirmationTokenHash: hashVerificationToken(token), confirmationExpiresAt: new Date(now.getTime() + NEWSLETTER_CONFIRMATION_TTL_MS), confirmationSentAt: now } },
    { returnDocument: "after" }
  ).lean();
  if (!issued) return;

  runAfterResponse("newsletter confirmation", () => sendNewsletterConfirmationEmail(email, token, issued.locale));
}

/**
 * Consumes a confirmation token and marks the address `SUBSCRIBED`. Single-use: one conditional write claims the
 * token (still pending, not expired) and clears it, so a replay, a stale link, or a link for an address that has
 * since unsubscribed fails — and the one error says nothing about which.
 */
export async function confirmNewsletterSubscription(token: string): Promise<void> {
  const now = new Date();
  const confirmed = await NewsletterSubscriberModel.findOneAndUpdate(
    { confirmationTokenHash: hashVerificationToken(token), confirmationExpiresAt: { $gt: now }, status: "PENDING" },
    {
      $set: { status: "SUBSCRIBED", consentedAt: now, confirmedAt: now },
      $unset: { confirmationTokenHash: "", confirmationExpiresAt: "", confirmationSentAt: "" },
    },
    { returnDocument: "after" }
  ).lean();

  if (!confirmed) throw new UnauthorizedError("This confirmation link is invalid or has expired.");
}
