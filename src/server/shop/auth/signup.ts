import { DuplicateKeyError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { hashPassword } from "@kira-joo/backend-toolkit-next";
import { randomBytes } from "node:crypto";
import { customerRepository } from "../../core/repositories";
import { sendVerificationEmail } from "../../core/mail/send-account-emails";
import { storePhoneLookupVariants } from "../../core/phone/store-phone";
import { VERIFICATION_TOKEN_TTL_MS } from "./customer-auth.constants";
import { hashVerificationToken } from "./hash-verification-token";
import { recordGrantedConsentOnCreate } from "../profile/marketing-consent";
import type { NewsletterLocale } from "../../newsletter/newsletter-subscriber.schema";

export interface SignupInput {
  /** Already canonical — `SignupDto` normalises it at the input boundary. */
  phone: string;
  email?: string;
  password: string;
  name: string;
  /**
   * The signup form's separate, UNTICKED marketing checkbox (legal-and-consent.md
   * §4) — never bundled with accepting the terms. Absent or false records
   * nothing: not having been asked is not consent.
   */
  marketingConsent?: boolean;
  /** The page language the visitor signed up in; the newsletter row keeps it. Defaults to the store's default, `ar`. */
  locale?: NewsletterLocale;
}

/**
 * Creates a customer account — or, if the phone (or, when given, the email) is
 * already registered, does NOTHING. It resolves the same way in both cases and
 * never returns a profile, an id, or a session, so a signup attempt is not an
 * account-existence oracle (the previous `ConflictError` and the auto-login were
 * both one). The caller answers `202 { status: "accepted" }` for both, with no
 * `Set-Cookie`; the customer then signs in through `login`.
 *
 * An existing account is never modified: password, name and email are untouched,
 * and no token is minted for it.
 *
 * **The password is hashed first, in both branches** — before the existence
 * lookup — so the slow scrypt/bcrypt work is not skipped for a registered phone.
 *
 * **Residual, documented, not closed:**
 *  - Timing: the new-account branch additionally performs an insert (and an email
 *    send when an email was given). That is milliseconds against a hash taking
 *    far longer, and signup is rate-limited per IP; it is not equalised.
 *  - The out-of-band oracle: a person who then tries `login` with the password they
 *    signed up with learns whether the account is theirs. This cannot be closed
 *    without proving control of the phone/email (SMS/OTP, deferred by owner
 *    decision): until then, whoever registers a phone first owns the account.
 *
 * `phoneVerified`/`emailVerified` stay `false` — no delivery channel exists in
 * v1 to confirm either, matching `CustomerSchema`'s documented state.
 */
export async function signupCustomer(input: SignupInput): Promise<void> {
  const passwordHash = await hashPassword(input.password);
  const email = input.email?.toLowerCase();

  // Legacy stored forms of this number (pre-normalisation) count as "taken" too, or a second account for one number would appear.
  const phones = storePhoneLookupVariants(input.phone);
  const existing = await customerRepository.findOne({
    where: email ? { $or: [{ phone: { $in: phones } }, { email }] } : { phone: { $in: phones } },
    select: { _id: true },
    skipThrowError: true,
  });
  if (existing) return;

  const verificationToken = email ? randomBytes(32).toString("base64url") : undefined;

  const document = {
    phone: input.phone,
    email,
    passwordHash,
    name: input.name,
    ...(verificationToken
      ? {
          emailVerificationTokenHash: hashVerificationToken(verificationToken),
          emailVerificationExpiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
        }
      : {}),
  };

  try {
    if (input.marketingConsent === true) {
      // The account, the consent on it and the consent record are one write — a customer is never left half-recorded.
      await withTransaction(async (tx) => {
        const now = new Date();
        const created = await customerRepository.save({ ...document, marketingConsent: { granted: true, at: now, source: "signup" } });
        await recordGrantedConsentOnCreate({ customerId: created._id, email, source: "signup", locale: input.locale ?? "ar", at: now });
        return tx.complete(undefined);
      });
    } else {
      await customerRepository.save(document);
    }
  } catch (error) {
    // Two concurrent signups for one phone/email: the unique index decides, and the loser is silent like any other duplicate.
    if (error instanceof DuplicateKeyError) return;
    throw error;
  }

  if (email && verificationToken) {
    await sendVerificationEmail(email, verificationToken);
  }
}
