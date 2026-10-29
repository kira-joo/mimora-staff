import type { CustomerIdentity } from "../core/auth/resolve-customer";
import { setMarketingConsent } from "../shop/profile/marketing-consent";
import type { NewsletterLocale } from "./newsletter-subscriber.schema";
import type { PublicNewsletterSource } from "./dto/subscribe-newsletter.dto";
import { normalizeEmail } from "./normalize-email";
import { requestNewsletterConfirmation } from "./confirmation";

/**
 * Handles a public newsletter request. A signed-in customer subscribing THEIR OWN
 * account email is giving marketing consent on that account (source `newsletter`),
 * so the account, its consent record and the list agree and one withdrawal in the
 * account unsubscribes it. Everyone else — a guest, or an address that is not the
 * signed-in account's — goes through double opt-in (`requestNewsletterConfirmation`):
 * a PENDING row and an emailed link, and it can never re-subscribe an address that was
 * unsubscribed (anyone can type anyone's address).
 *
 * Returns nothing, on purpose: the route answers identically whatever happened.
 */
export async function acceptNewsletterSubscription(input: {
  email: string;
  locale?: NewsletterLocale;
  source?: PublicNewsletterSource;
  customer?: CustomerIdentity;
}): Promise<void> {
  const email = normalizeEmail(input.email);
  const locale = input.locale ?? "ar";

  if (input.customer?.email && normalizeEmail(input.customer.email) === email) {
    await setMarketingConsent(input.customer._id, { granted: true, source: "newsletter", locale });
    return;
  }
  await requestNewsletterConfirmation({ email, locale, source: input.source ?? "footer" });
}
