import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { customerRepository } from "../../core/repositories";
import { moveNewsletterSubscription } from "../../newsletter/subscribe";
import type { ProfileView } from "./get-profile";
import { toConsentView } from "./marketing-consent";

export interface UpdateProfileInput {
  name: string;
  email?: string;
}

/**
 * Updates the authenticated customer's profile.
 *
 * - `name` is always required.
 * - `email` is optional but must be unique when provided (sparse index).
 * - **A changed email is unverified.** `emailVerified` was earned by proving control of the OLD address, so a new
 *   address starts at `false`, and any outstanding verification token (issued for the old address) is cleared — it
 *   must not be able to verify the new one. Re-sending the same address, or differing only in case, changes nothing.
 * - **Marketing consent follows the email.** When the address changes while consent is granted, the newsletter
 *   subscription moves to the new address (old one unsubscribed, new one subscribed) in the SAME transaction as
 *   the customer row: consent was given to be written to this person, wherever they now ask to be reached, and
 *   leaving the old address subscribed would keep writing to a mailbox they no longer claim.
 *
 * @throws {ConflictError} The email is already registered to another customer.
 */
export async function updateProfile(customerId: string, input: UpdateProfileInput): Promise<ProfileView> {
  return withTransaction(async (tx) => {
    if (input.email) {
      const existing = await customerRepository.findOne({ where: { email: input.email, _id: { $ne: customerId } }, skipThrowError: true });
      if (existing) {
        throw new ConflictError("This email is already registered to another account.");
      }
    }

    const before = await customerRepository.findOne({ where: { _id: customerId }, skipThrowError: true });

    const emailChanged = Boolean(input.email) && input.email!.trim().toLowerCase() !== (before?.email ?? "").toLowerCase();

    const updated = await customerRepository.updateAtomic(
      { _id: customerId },
      emailChanged
        ? { $set: { name: input.name, email: input.email, emailVerified: false }, $unset: { emailVerificationTokenHash: "", emailVerificationExpiresAt: "" } }
        : { $set: { name: input.name, email: input.email } },
      { skipThrowError: true }
    );

    if (!updated) {
      throw new Error("Customer not found");
    }

    // `moveNewsletterSubscription` is a no-op when the address did not actually change.
    if (input.email && before?.marketingConsent?.granted === true && !before.redactedAt) {
      await moveNewsletterSubscription({ customerId: updated._id, oldEmail: before.email, newEmail: input.email });
    }

    return tx.complete({
      _id: updated._id.toString(),
      name: updated.name,
      phone: updated.phone,
      email: updated.email,
      phoneVerified: updated.phoneVerified,
      emailVerified: updated.emailVerified,
      marketingConsent: toConsentView(updated.marketingConsent),
      createdAt: (updated as any).createdAt,
      updatedAt: (updated as any).updatedAt,
    });
  });
}
