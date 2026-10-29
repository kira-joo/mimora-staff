// Mirror of src/server/core/phone/normalize-phone.ts for plain-node scripts. Kept in lock-step by
// src/server/core/phone/normalize-phone.parity.test.ts, which compares the two on many inputs.
export function cleanPhone(raw) {
  return raw
    .replace(/[٠-٩۰-۹]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(/[\s\-.()/ ​-‏‪-‮⁦-⁩﻿]/g, "");
}
const E164 = /^\+[1-9]\d{7,14}$/;
export const isValidCountryCallingCode = (cc) => /^[1-9]\d{0,2}$/.test(cc);
export function normalizePhone(raw, defaultCountryCode) {
  let value = cleanPhone(raw);
  if (value.startsWith("00") && !value.startsWith("+")) value = `+${value.slice(2)}`;
  if (value.startsWith("+")) return value;
  const cc = defaultCountryCode && isValidCountryCallingCode(defaultCountryCode) ? defaultCountryCode : undefined;
  if (cc && /^0\d+$/.test(value) && value.length > 1) {
    const candidate = `+${cc}${value.slice(1)}`;
    if (E164.test(candidate)) return candidate;
  }
  return value;
}
