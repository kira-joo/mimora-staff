import { DuplicateKeyError } from "@kira-joo/backend-toolkit-core";
import { resolveSession } from "@kira-joo/backend-toolkit-mongoose";
import type mongoose from "mongoose";
import { newsletterSubscriberRepository } from "../core/repositories";
import { NewsletterSubscriberModel, type NewsletterLocale, type NewsletterSource } from "./newsletter-subscriber.schema";
import { normalizeEmail } from "./normalize-email";

export interface SubscribeInput {
  email: string;
  locale: NewsletterLocale;
  source: NewsletterSource;
  customerId?: mongoose.Types.ObjectId | string;
  /**
   * `false` for a PUBLIC request — anyone can type anyone's address, so it never
   * overrides a suppression: an address that was unsubscribed stays unsubscribed.
   * `true` only for an act the address's owner is authenticated for (turning
   * marketing consent on in their own account), which re-subscribes it — and
   * confirms a `PENDING` one: the account holder IS the owner, so no emailed
   * link is needed.
   */
  reactivate?: boolean;
}

/**
 * Subscribes an address. **Idempotent per address**: a second subscription,
 * public or concurrent, changes nothing — in particular it never moves
 * `consentedAt`, the proof of WHEN consent was first given. It also never reports
 * whether the address already existed, so the caller can answer identically
 * either way (no "already subscribed" oracle over who is on the list).
 *
 * Reads and writes only this one collection, so it joins whatever transaction
 * the caller is in (the ambient session) without a `session` parameter.
 */
export async function subscribeToNewsletter(input: SubscribeInput): Promise<void> {
  const email = normalizeEmail(input.email);
  const now = new Date();

  try {
    await newsletterSubscriberRepository.updateAtomic(
      { email },
      {
        $setOnInsert: {
          email,
          locale: input.locale,
          source: input.source,
          status: "SUBSCRIBED",
          consentedAt: now,
          ...(input.customerId ? { customerId: input.customerId } : {}),
        },
      },
      { upsert: true, skipThrowError: true }
    );
  } catch (error) {
    // Two concurrent first-time subscriptions: the unique index decided, and the loser is already subscribed.
    if (!(error instanceof DuplicateKeyError)) throw error;
  }

  if (input.reactivate) {
    await newsletterSubscriberRepository.updateAtomic(
      { email, status: { $in: ["UNSUBSCRIBED", "PENDING"] } },
      {
        $set: { status: "SUBSCRIBED", consentedAt: now, source: input.source, locale: input.locale, ...(input.customerId ? { customerId: input.customerId } : {}) },
        $unset: { unsubscribedAt: "", confirmationTokenHash: "", confirmationExpiresAt: "", confirmationSentAt: "" },
      },
      { skipThrowError: true }
    );
  }
}

/**
 * Marks every SUBSCRIBED or PENDING row matching `match` as unsubscribed now (a pending address that withdraws
 * must not be confirmable later; its link dies with it). Rows are kept: they are the suppression list. A multi-row update the repository cannot express,
 * so it is a direct Model call — which must hand over the ambient session itself,
 * or inside a transaction it would commit outside it.
 */
export async function unsubscribeNewsletter(match: Record<string, unknown>): Promise<number> {
  const result = await NewsletterSubscriberModel.updateMany(
    { ...match, status: { $in: ["SUBSCRIBED", "PENDING"] } },
    { $set: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() }, $unset: { confirmationTokenHash: "", confirmationExpiresAt: "", confirmationSentAt: "" } },
    { session: resolveSession() }
  );
  return result.modifiedCount;
}

/**
 * A customer with marketing consent changed the email on their account: the subscription follows the account.
 *
 * The old address is unsubscribed (kept as a suppression, like any other unsubscribe) and the new one is subscribed
 * directly — this is the account holder's own authenticated act on consent they already gave, the same footing as
 * turning marketing consent on (`reactivate`), so no emailed link is needed. Both writes join the caller's
 * transaction (`profile update` runs them with the customer row, so a failure leaves all three unchanged).
 *
 * A no-op when the address did not actually change. `oldEmail` may be absent (the account had none): then there is
 * nothing to unsubscribe, only the new address to subscribe.
 */
export async function moveNewsletterSubscription(input: {
  customerId: mongoose.Types.ObjectId | string;
  oldEmail?: string;
  newEmail: string;
  locale?: NewsletterLocale;
}): Promise<void> {
  const next = normalizeEmail(input.newEmail);
  const previous = input.oldEmail ? normalizeEmail(input.oldEmail) : undefined;
  if (previous === next) return;

  if (previous) await unsubscribeNewsletter({ $or: [{ customerId: input.customerId }, { email: previous }] });
  await subscribeToNewsletter({ email: next, locale: input.locale ?? "ar", source: "account", customerId: input.customerId, reactivate: true });
}
