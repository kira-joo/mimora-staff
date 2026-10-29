import { ConfigurationError } from "@kira-joo/backend-toolkit-core";
import { cleanPhone, isValidCountryCallingCode } from "../phone/normalize-phone";

/**
 * The deployment's default country calling code (`STORE_PHONE_COUNTRY_CODE`,
 * digits only: `20` Egypt, `966` Saudi Arabia) — deployment configuration like
 * `STORE_TIMEZONE`, no schema involved.
 *
 * Optional. Unset means a national number (`01012345678`) is NOT converted to
 * E.164 — a country is never guessed — and `instrumentation.ts` says so at
 * boot. Set but malformed is a hard error: a typo must not silently disable it.
 */
export function storePhoneCountryCode(): string | undefined {
  const value = process.env.STORE_PHONE_COUNTRY_CODE?.trim();
  if (!value) return undefined;
  if (!isValidCountryCallingCode(value)) {
    throw new ConfigurationError(`STORE_PHONE_COUNTRY_CODE "${value}" must be a country calling code written as digits only (1-3 digits, no "+"), e.g. 20.`);
  }
  return value;
}

/**
 * Does STORE_PHONE_COUNTRY_CODE agree with the store's own configuration? The store profile's contact
 * number is the merchant's own, written internationally (+20 … for an Egyptian store, +966 … for a
 * Saudi one), so it is the evidence of which country the deployment serves. A mismatch is not a
 * syntax error — the code is a valid calling code — it is the wrong country, which would store every
 * new national-format customer number under someone else's country code. Returns the problem, or null.
 */
export function phoneCountryMismatch(configured: string | undefined, storeContactPhone: string | undefined): string | null {
  const contact = storeContactPhone ? cleanPhone(storeContactPhone) : "";
  if (!contact.startsWith("+")) return null; // no international contact number to compare against
  if (!configured) return `STORE_PHONE_COUNTRY_CODE is not set, but the store's own contact number is international (${contact.slice(0, 5)}…). Set it to that country's calling code.`;
  if (contact.startsWith(`+${configured}`)) return null;
  return `STORE_PHONE_COUNTRY_CODE is ${configured}, but the store's own contact number starts ${contact.slice(0, 5)}… — the configured country looks wrong. New national-format customer numbers would be stored as +${configured}….`;
}
