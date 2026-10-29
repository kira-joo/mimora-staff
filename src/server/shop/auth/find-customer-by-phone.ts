import { CustomerModel } from "../../identity/customer.schema";
import { normalizeStorePhone, storePhoneLookupVariants } from "../../core/phone/store-phone";

/**
 * Finds the customer for a typed phone number, tolerating records stored before
 * normalisation existed (`01012345678`, `201012345678`, as-typed with spaces…).
 * One query over every form the input could be stored in; the canonical record wins
 * if a legacy twin also exists. New records are always written canonical, so this
 * fallback only ever matters for pre-normalisation accounts.
 */
export async function findCustomerByPhone(rawPhone: string, options: { withPasswordHash?: boolean } = {}) {
  // A redacted account (its phone is a non-PII placeholder) is never a login or recovery target, however the placeholder is typed.
  const query = CustomerModel.find({ phone: { $in: storePhoneLookupVariants(rawPhone) }, redactedAt: { $exists: false } });
  if (options.withPasswordHash) query.select("+passwordHash");
  const matches = await query;
  const canonical = normalizeStorePhone(rawPhone);
  return matches.find((m) => m.phone === canonical) ?? matches[0] ?? null;
}
