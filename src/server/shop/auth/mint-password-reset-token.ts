import { randomBytes } from "node:crypto";
import type mongoose from "mongoose";
import { customerRepository } from "../../core/repositories";
import { VERIFICATION_TOKEN_TTL_MS } from "./customer-auth.constants";
import { hashVerificationToken } from "./hash-verification-token";

/**
 * Mints a password-reset token for one customer and stores ONLY its hash and expiry —
 * the single place a customer reset credential is made, so the self-service path
 * (`requestPasswordReset`) and the staff-assisted one (the console's "Create reset
 * link") cannot drift apart in entropy, hashing or lifetime. Replaces any
 * outstanding token: one live reset credential per customer.
 *
 * Returns the plaintext, which exists only in the caller's memory from here on:
 * it is handed to the customer by a channel (email, or staff by another route) and
 * never persisted or logged.
 */
export async function mintPasswordResetToken(customerId: mongoose.Types.ObjectId | string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
  await customerRepository.updateAtomic({ _id: customerId }, { $set: { passwordResetTokenHash: hashVerificationToken(token), passwordResetExpiresAt: expiresAt } });
  return { token, expiresAt };
}
