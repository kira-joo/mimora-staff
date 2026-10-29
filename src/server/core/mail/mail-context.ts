import { resolveLocalized } from "@kira-joo/toolkit-common";
import { storeProfileRepository } from "../repositories";
import { mailLinkBases } from "./mail-config";
import type { MailLocale } from "./templates/layout";

/**
 * What every message needs from the store: its name in the message's language,
 * its currency, its contact address, and the two link bases.
 */
export interface MailContext {
  locale: MailLocale;
  /** Already resolved to `locale`. */
  storeName: string;
  currency: string;
  contactEmail?: string;
  storefrontUrl: string;
  backofficeUrl: string;
}

const FALLBACK_STORE_NAME = "Store";

const asLocale = (value: unknown): MailLocale => (value === "en" ? "en" : "ar");

/**
 * Loads the store profile's identity for a message.
 *
 * The language is the recipient's preferred locale if the account has one —
 * the customer model has none today, so callers pass nothing — otherwise the
 * store profile's default locale. A missing profile (a fresh database) falls
 * back to Arabic and a neutral name rather than failing: a message is still
 * better than none, and the callers never let this throw into a business flow.
 */
export async function loadMailContext(preferredLocale?: MailLocale): Promise<MailContext> {
  const profile = await storeProfileRepository.findOne({ where: {}, skipThrowError: true, lean: true });
  const locale = preferredLocale ?? asLocale(profile?.defaultLocale);
  const storeName = (profile ? resolveLocalized(profile.name, locale) : "") || FALLBACK_STORE_NAME;
  return {
    locale,
    storeName,
    currency: profile?.currency ?? "",
    contactEmail: profile?.contact?.email || undefined,
    ...mailLinkBases(process.env),
  };
}
