import { Transform } from "class-transformer";
import { IsEmail, IsIn, IsOptional, MaxLength } from "class-validator";
import { NEWSLETTER_LOCALES, type NewsletterLocale } from "../newsletter-subscriber.schema";
import { normalizeEmail } from "../normalize-email";

/** Where a PUBLIC subscription can come from — the other sources are set by the server, never claimed by a caller. */
export const PUBLIC_NEWSLETTER_SOURCES = ["footer", "checkout"] as const;
export type PublicNewsletterSource = (typeof PUBLIC_NEWSLETTER_SOURCES)[number];

export class SubscribeNewsletterDto {
  @Transform(({ value }) => (typeof value === "string" ? normalizeEmail(value) : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsIn(NEWSLETTER_LOCALES)
  locale?: NewsletterLocale;

  @IsOptional()
  @IsIn(PUBLIC_NEWSLETTER_SOURCES)
  source?: PublicNewsletterSource;
}
