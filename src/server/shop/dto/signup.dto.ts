import { IsStorePhone, NormalizePhone } from "src/server/core/phone/store-phone";
import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { NEWSLETTER_LOCALES, type NewsletterLocale } from "../../newsletter/newsletter-subscriber.schema";

export class SignupDto {
  @IsString()
  @Trim()
  @NormalizePhone()
  @IsStorePhone()
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(8, { message: "password must be at least 8 characters." })
  password!: string;

  @IsString()
  @Trim()
  @MinLength(1)
  name!: string;

  /** The separate, unticked marketing checkbox — see `SignupInput.marketingConsent`. */
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  @IsOptional()
  @IsIn(NEWSLETTER_LOCALES)
  locale?: NewsletterLocale;
}
