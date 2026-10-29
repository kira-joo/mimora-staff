import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import type mongoose from "mongoose";
import { consentEventRepository, customerRepository } from "../../core/repositories";
import type { MarketingConsent, MarketingConsentSource } from "../../identity/customer.schema";
import type { NewsletterLocale } from "../../newsletter/newsletter-subscriber.schema";
import { subscribeToNewsletter, unsubscribeNewsletter } from "../../newsletter/subscribe";

/** What a customer (and the console) sees of consent: the current state, and when/where it last changed. */
export interface MarketingConsentView {
  granted: boolean;
  at?: Date;
  source?: MarketingConsentSource;
}

/** ABSENT consent is "never asked", which is NOT consent — so the default is `granted: false`. */
export function toConsentView(consent: MarketingConsent | undefined | null): MarketingConsentView {
  if (!consent) return { granted: false };
  return { granted: consent.granted === true, at: consent.at, source: consent.source };
}

export interface SetConsentInput {
  granted: boolean;
  /** Where the change happened — the server decides; a caller's claim is never trusted beyond this union. */
  source: Exclude<MarketingConsentSource, "signup">;
  locale?: NewsletterLocale;
}

/**
 * Records consent given with the account's creation: the event row, and — when
 * the account has an email — the newsletter row. Called by signup inside the same
 * transaction that creates the customer, so there is never an account that claims
 * consent with no record of it.
 */
export async function recordGrantedConsentOnCreate(input: {
  customerId: mongoose.Types.ObjectId;
  email?: string;
  source: MarketingConsentSource;
  locale: NewsletterLocale;
  at: Date;
}): Promise<void> {
  await consentEventRepository.save({ customerId: input.customerId, granted: true, source: input.source, at: input.at });
  if (input.email) {
    await subscribeToNewsletter({ email: input.email, locale: input.locale, source: input.source, customerId: input.customerId, reactivate: true });
  }
}

/**
 * Grants or withdraws the signed-in customer's marketing consent — the one control
 * (legal-and-consent.md §4): effective immediately, no dark pattern, and EVERYWHERE
 * the consent is acted on, so a withdrawal also unsubscribes the newsletter row —
 * otherwise a sender reading the newsletter list would write to someone who said no.
 *
 * One transaction: the state on the customer, the append-only event, and the
 * newsletter row move together or not at all. **Idempotent**: repeating the current
 * state writes nothing — in particular it does not move `at`, the time consent was
 * actually given. Withdrawing when consent was never given is likewise a no-op.
 */
export async function setMarketingConsent(customerId: string, input: SetConsentInput): Promise<MarketingConsentView> {
  return withTransaction(async (tx) => {
    const customer = await customerRepository.findOne({ where: { _id: customerId }, skipThrowError: true });
    if (!customer || customer.redactedAt) throw new NotFoundError("Customer not found");

    const currentlyGranted = customer.marketingConsent?.granted === true;
    if (currentlyGranted === input.granted) return tx.complete(toConsentView(customer.marketingConsent));

    const now = new Date();
    const consent: MarketingConsent = { granted: input.granted, at: now, source: input.source };
    await customerRepository.updateAtomic({ _id: customer._id }, { $set: { marketingConsent: consent } });
    await consentEventRepository.save({ customerId: customer._id, granted: input.granted, source: input.source, at: now });

    if (input.granted) {
      if (customer.email) await subscribeToNewsletter({ email: customer.email, locale: input.locale ?? "ar", source: input.source, customerId: customer._id, reactivate: true });
    } else {
      await unsubscribeNewsletter({ $or: [{ customerId: customer._id }, ...(customer.email ? [{ email: customer.email }] : [])] });
    }
    return tx.complete(toConsentView(consent));
  });
}
