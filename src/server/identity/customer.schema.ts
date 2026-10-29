import {
  MongoField,
  MongoSchema,
  Unique,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * Where marketing consent was given or withdrawn. `newsletter` is consent
 * given through the public newsletter form by a visitor who is signed in.
 */
export const MARKETING_CONSENT_SOURCES = ["signup", "account", "checkout", "newsletter"] as const;
export type MarketingConsentSource = (typeof MARKETING_CONSENT_SOURCES)[number];

/**
 * The customer's CURRENT marketing consent and when/where it last changed
 * (legal-and-consent.md §2: "proving consent was given … until withdrawn, plus a
 * record that it was"). The history of changes is the append-only
 * `ConsentEvent` collection; this is the state a sender must check.
 */
export interface MarketingConsent {
  granted: boolean;
  at: Date;
  source: MarketingConsentSource;
}

/** Hand-written sub-schema: not checked against the interface above — `customer.schema.integration.test.ts` round-trips it. */
const marketingConsentSchema = new mongoose.Schema(
  {
    granted: { type: Boolean, required: true },
    at: { type: Date, required: true },
    source: { type: String, enum: MARKETING_CONSENT_SOURCES, required: true },
  },
  { _id: false }
);

/**
 * Customer account.
 *
 * Per D-9: phone is the primary identifier (unique, required); email is
 * optional but unique when present (sparse index). Both login identifiers
 * are accepted, but phone is the field customers recall.
 *
 * Phone stored E.164-normalized with the deployment's country as default
 * region, so 01012345678 and +201012345678 cannot become two accounts.
 *
 * Verification flags exist but stay false in v1 (no SMS/email provider yet).
 */
@MongoSchema({ timestamps: true })
export class CustomerSchema {
  _id!: mongoose.Types.ObjectId;

  @Unique()
  @MongoField({ type: String, required: true, trim: true })
  phone!: string;

  @Unique({ sparse: true })
  @MongoField({ type: String, required: false, lowercase: true, trim: true })
  email?: string;

  @MongoField({ type: String, required: true, select: false })
  passwordHash!: string;

  @MongoField({ type: String, required: true, trim: true })
  name!: string;

  @MongoField({ type: Boolean, default: false })
  phoneVerified!: boolean;

  @MongoField({ type: Boolean, default: false })
  emailVerified!: boolean;

  /**
   * Password reset token hash. Plaintext token is minted, hashed, and
   * discarded rather than returned. No delivery channel in v1 (D-8).
   * `select: false` like `passwordHash` (and the staff schema's own reset
   * token): a hash, and when it expires, never leave in a response. The
   * flows that use it filter on it, which `select: false` does not affect.
   */
  @MongoField({ type: String, required: false, select: false })
  passwordResetTokenHash?: string;

  @MongoField({ type: Date, required: false, select: false })
  passwordResetExpiresAt?: Date;

  /**
   * Email-verification token hash — Phase 4B, Shop Authentication batch.
   * Absent until this pass: only password reset had this pattern before,
   * and `verify-email`/`resend-verification` cannot function without their
   * own equivalent server-side token storage. Same discipline as
   * `passwordResetTokenHash`: plaintext minted, hashed, and discarded, no
   * delivery channel in v1 (D-8) — `resend-verification`'s outbound
   * notification goes through the existing no-op `OutboundNotifier`.
   */
  @MongoField({ type: String, required: false, select: false })
  emailVerificationTokenHash?: string;

  @MongoField({ type: Date, required: false, select: false })
  emailVerificationExpiresAt?: Date;

  @MongoField({ type: Number, default: 1 })
  tokenVersion!: number;

  /**
   * Marketing consent (legal-and-consent.md §4). ABSENT means never asked, which
   * is NOT consent: nothing is ever pre-ticked, so the default is "not granted"
   * and a sender must read `marketingConsent?.granted === true`, never "not false".
   */
  @MongoField({ type: marketingConsentSchema, required: false })
  marketingConsent?: MarketingConsent;

  /**
   * Set when staff redact this account (legal-and-consent.md §5). A redacted
   * customer is a shell kept only because orders, returns and reviews point at
   * its `_id`: name, phone, email and credentials are gone, it cannot sign in or
   * be reset, and its phone/email can be registered again by someone new.
   */
  @MongoField({ type: Date, required: false })
  redactedAt?: Date;
}

export const CustomerModel = createMongoModel("Customer", CustomerSchema);
