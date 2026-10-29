import { IsBoolean, IsIn, IsOptional } from "class-validator";
import { NEWSLETTER_LOCALES, type NewsletterLocale } from "../../newsletter/newsletter-subscriber.schema";

/** The two places a signed-in customer changes consent: their account, or the checkout opt-in. */
export const CUSTOMER_CONSENT_SOURCES = ["account", "checkout"] as const;

export class SetMarketingConsentDto {
  @IsBoolean()
  granted!: boolean;

  @IsOptional()
  @IsIn(CUSTOMER_CONSENT_SOURCES)
  source?: (typeof CUSTOMER_CONSENT_SOURCES)[number];

  @IsOptional()
  @IsIn(NEWSLETTER_LOCALES)
  locale?: NewsletterLocale;
}
