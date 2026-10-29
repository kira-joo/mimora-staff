import { Transform } from "class-transformer";
import { registerDecorator, type ValidationOptions } from "class-validator";
import { storePhoneCountryCode } from "../config/store-phone-country";
import { isValidCanonicalPhone, normalizePhone, phoneLookupVariants } from "./normalize-phone";

/** Canonical form of a customer phone under this deployment's configuration. */
export function normalizeStorePhone(raw: string): string {
  return normalizePhone(raw, storePhoneCountryCode());
}

export function storePhoneLookupVariants(raw: string): string[] {
  return phoneLookupVariants(raw, storePhoneCountryCode());
}

/**
 * DTO boundary: replaces a string phone with its canonical form (non-strings pass through
 * so `@IsString` reports them). Place it AFTER `@Trim()` / before the validators.
 */
export function NormalizePhone(): PropertyDecorator {
  return Transform(({ value }) => (typeof value === "string" ? normalizeStorePhone(value) : value));
}

/** Valid once normalised — E.164 (8-15 digits after +) or a 5-15 digit national number. Rejects letters. */
export function IsStorePhone(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: "isStorePhone",
      target: target.constructor,
      propertyName: propertyKey as string,
      options: { message: "phone must be a valid phone number.", ...options },
      validator: { validate: (value: unknown) => typeof value === "string" && isValidCanonicalPhone(normalizeStorePhone(value)) },
    });
}
