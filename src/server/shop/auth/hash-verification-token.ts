import { createHash } from "node:crypto";

/**
 * Shared by `signup`, `forgot-password`, `reset-password`, `verify-email`,
 * and `resend-verification` — every one of them mints a plaintext token,
 * stores only its hash, and discards the plaintext (the same discipline
 * `CustomerSchema.passwordResetTokenHash`'s own doc comment states).
 * SHA-256 is sufficient for the same reason `hashRefreshToken` gives: this
 * is high-entropy random data the caller never chose, not a password, so
 * there is nothing to brute-force and no need for a slow, salted hash.
 */
export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
