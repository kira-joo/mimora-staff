import { UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import { customerRepository } from "../../core/repositories";
import { hashVerificationToken } from "./hash-verification-token";

/**
 * Consumes an email-verification token and marks the customer's email as
 * verified. Single-use, same discipline as `resetPassword`:
 * `emailVerificationTokenHash`/`emailVerificationExpiresAt` are cleared
 * unconditionally on success, so a retry with the same token fails cleanly
 * instead of silently re-verifying.
 *
 * Unlike a password reset, verifying an email does not touch any session —
 * there is nothing here for `tokenVersion`/`revokeAllForSubject` to protect
 * against.
 */
export async function verifyEmail(token: string): Promise<void> {
  const tokenHash = hashVerificationToken(token);
  // One conditional write claims the token and marks the email verified.
  const customer = await customerRepository.updateAtomic(
    { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: { $gt: new Date() } },
    { $set: { emailVerified: true }, $unset: { emailVerificationTokenHash: "", emailVerificationExpiresAt: "" } },
    { skipThrowError: true }
  );

  if (!customer) {
    throw new UnauthorizedError("This verification link is invalid or has expired.");
  }

}
