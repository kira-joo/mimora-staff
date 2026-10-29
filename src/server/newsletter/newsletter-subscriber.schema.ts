import { MongoField, MongoSchema, Relation, Unique, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

export const NEWSLETTER_SOURCES = ["footer", "checkout", "signup", "account", "newsletter"] as const;
export type NewsletterSource = (typeof NEWSLETTER_SOURCES)[number];
export const NEWSLETTER_STATUSES = ["PENDING", "SUBSCRIBED", "UNSUBSCRIBED"] as const;
export type NewsletterStatus = (typeof NEWSLETTER_STATUSES)[number];
export const NEWSLETTER_LOCALES = ["ar", "en"] as const;
export type NewsletterLocale = (typeof NEWSLETTER_LOCALES)[number];

/**
 * A newsletter address and the consent behind it (task #42). Capture only —
 * nothing sends yet, and nothing may until a sender reads `status === SUBSCRIBED`.
 *
 * **Double opt-in.** A PUBLIC request (anyone can type anyone's address) creates a
 * `PENDING` row. It becomes `SUBSCRIBED` only when the address's owner follows the
 * single-use link we email (`confirmationTokenHash`, stored hashed; the plaintext
 * lives in the email alone). With mail not configured no link can be sent, so the row
 * stays `PENDING` and the console says so — pending is NOT consent, and no sender may
 * treat it as such. An authenticated act on the address's own account (turning
 * marketing consent on) needs no confirmation and subscribes directly.
 *
 * `email` is the identity: lower-cased and unique, so subscribing twice is one
 * row. `consentedAt` is when consent was FIRST given (the confirmation, for a public
 * subscription — absent while pending) and is never moved by a repeat subscription; `unsubscribedAt` records a withdrawal. The row is kept
 * after unsubscribing — a suppression list: forgetting an address that asked not
 * to be written to is how it gets written to again.
 *
 * `customerId` links the row to an account when the subscriber was signed in
 * (or consented through the account), so withdrawing consent there can
 * unsubscribe here, and so redacting the account can delete the row.
 */
@MongoSchema({ timestamps: true })
export class NewsletterSubscriberSchema {
  _id!: mongoose.Types.ObjectId;

  @Unique()
  @MongoField({ type: String, required: true, lowercase: true, trim: true })
  email!: string;

  @MongoField({ type: String, enum: [...NEWSLETTER_LOCALES], required: true, default: "ar" })
  locale!: NewsletterLocale;

  @MongoField({ type: String, enum: [...NEWSLETTER_STATUSES], required: true, default: "SUBSCRIBED" })
  status!: NewsletterStatus;

  @MongoField({ type: String, enum: [...NEWSLETTER_SOURCES], required: true })
  source!: NewsletterSource;

  /** When consent was first given. Absent while `PENDING`: an unconfirmed address has not consented. */
  @MongoField({ type: Date, required: false })
  consentedAt?: Date;

  /** SHA-256 of the single-use confirmation token. Cleared on use, on unsubscribe and on re-issue. Never the plaintext. */
  @MongoField({ type: String, required: false, select: false })
  confirmationTokenHash?: string;

  @MongoField({ type: Date, required: false })
  confirmationExpiresAt?: Date;

  /** When the last confirmation email was issued — throttles re-sends to a pending address. */
  @MongoField({ type: Date, required: false })
  confirmationSentAt?: Date;

  /** When the address's owner confirmed through the emailed link. */
  @MongoField({ type: Date, required: false })
  confirmedAt?: Date;

  @MongoField({ type: Date, required: false })
  unsubscribedAt?: Date;

  @Relation(() => CustomerRef)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false, ref: "Customer", index: true })
  customerId?: mongoose.Types.ObjectId;
}

class CustomerRef {
  _id!: mongoose.Types.ObjectId;
}

export const NewsletterSubscriberModel = createMongoModel("NewsletterSubscriber", NewsletterSubscriberSchema);
