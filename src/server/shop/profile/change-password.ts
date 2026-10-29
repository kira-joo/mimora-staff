import mongoose from "mongoose";
import { UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import { resolveSession, revokeAllForSubject, withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { comparePassword, hashPassword } from "@kira-joo/backend-toolkit-next";
import { customerRepository } from "../../core/repositories";
import { CustomerModel } from "../../identity/customer.schema";
import { CustomerRefreshTokenModel } from "../../identity/customer-refresh-token.schema";

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
}

/**
 * Changes the authenticated customer's password.
 *
 * - Verifies the old password matches current hash.
 * - Updates to new password hash.
 * - Increments `tokenVersion`, which kills every outstanding access token, and revokes every refresh-token
 *   family, which kills every session's ability to mint a new one. The second half is the one that matters:
 *   `refresh` signs a new access token with the CURRENT `tokenVersion`, so without the revocation a stolen
 *   refresh token outlived the very password change meant to lock its thief out. Both writes are one transaction.
 *
 * The customer must re-authenticate after this operation.
 *
 * @throws {UnauthorizedError} The old password is incorrect.
 */
export async function changePassword(customerId: string, input: ChangePasswordInput): Promise<void> {
  // Direct Model use: the repository's projection deliberately skips `select: false` fields, so it cannot read `passwordHash`.
  const customer = await CustomerModel.findById(customerId).select("+passwordHash");
  if (!customer) {
    throw new Error("Customer not found");
  }

  const matches = await comparePassword(input.oldPassword, customer.passwordHash);
  if (!matches) {
    throw new UnauthorizedError("Current password is incorrect.");
  }

  const newPasswordHash = await hashPassword(input.newPassword);

  await withTransaction(async (tx) => {
    await customerRepository.updateAtomic(
      { _id: customerId },
      {
        $set: { passwordHash: newPasswordHash },
        $inc: { tokenVersion: 1 },
      },
      { skipThrowError: true }
    );
    await revokeAllForSubject(CustomerRefreshTokenModel, customer._id, resolveSession());
    return tx.complete(undefined);
  });
}
