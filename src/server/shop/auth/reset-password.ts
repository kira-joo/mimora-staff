import { UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import { resolveSession, revokeAllForSubject, withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { hashPassword } from "@kira-joo/backend-toolkit-next";
import { customerRepository } from "../../core/repositories";
import { CustomerRefreshTokenModel } from "../../identity/customer-refresh-token.schema";
import { hashVerificationToken } from "./hash-verification-token";

/**
 * Consumes a password-reset token, sets the new password, and signs the
 * customer out **everywhere** — bumping `tokenVersion` invalidates every
 * already-issued access token immediately (`resolveCustomerFromAccessToken`
 * checks it on every request), and `revokeAllForSubject` revokes every
 * refresh token too. A password reset is exactly the moment every existing
 * session should end, including whichever device is stolen or
 * compromised, not just the one performing the reset.
 *
 * The token is single-use: `passwordResetTokenHash`/`passwordResetExpiresAt`
 * are cleared unconditionally as part of the same update, so a retry with
 * the same token (outside of a `claimIdempotentMutation` replay window)
 * fails cleanly rather than silently resetting the password twice.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenHash = hashVerificationToken(token);

  const passwordHash = await hashPassword(newPassword);

  // One conditional write claims the token and sets the password, so a used or
  // expired token matches nothing and two concurrent resets cannot both land. The refresh-family
  // revocation shares its transaction: a password reset that left sessions alive is not one.
  await withTransaction(async (tx) => {
    const customer = await customerRepository.updateAtomic(
      { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { $gt: new Date() } },
      {
        $set: { passwordHash },
        $unset: { passwordResetTokenHash: "", passwordResetExpiresAt: "" },
        $inc: { tokenVersion: 1 },
      },
      { skipThrowError: true }
    );
    if (!customer) {
      throw new UnauthorizedError("This password reset link is invalid or has expired.");
    }
    await revokeAllForSubject(CustomerRefreshTokenModel, customer._id, resolveSession());
    return tx.complete(undefined);
  });
}
