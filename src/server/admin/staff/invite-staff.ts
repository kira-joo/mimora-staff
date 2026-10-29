import { randomBytes } from "node:crypto";
import { ConflictError, DuplicateKeyError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";
import { staffUserRepository } from "../../core/repositories";
import { assertRolesExist } from "../../identity/assert-roles-exist";
import { sendStaffInvitationEmail } from "../../core/mail/send-account-emails";
import { hashVerificationToken } from "../../shop/auth/hash-verification-token";
import type { InviteStaffDto } from "../dto/invite-staff.dto";

import { STAFF_INVITE_TOKEN_TTL_MS } from "../../core/auth/staff-auth.constants";

export interface StaffInvitation {
  /** The plaintext token, returned once to the inviting administrator — only its hash is stored. */
  token: string;
  expiresAt: Date;
}

/**
 * D-8: "No flow may depend on email to complete." There is no mail transport
 * yet, so the invitation is handed to the authenticated administrator who
 * created it (they pass it to the invitee) as well as to the notifier, which
 * delivers it for real once a transport exists. The inviter already holds
 * `StaffUser.manage`; returning the token to them grants nothing they could
 * not do themselves. Customer password reset is different and never returns
 * its token — there the requester is unauthenticated.
 */
function mintInvitation(now: Date): StaffInvitation & { tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashVerificationToken(token), expiresAt: new Date(now.getTime() + STAFF_INVITE_TOKEN_TTL_MS) };
}

async function sendInvitation(email: string, token: string, name?: string): Promise<void> {
  await sendStaffInvitationEmail(email, name, token);
}

/**
 * Invites a staff member. MDS §2/§18: "Staff accounts are invite-only. No
 * self-signup route exists, and none may be added."
 *
 * **No password is set here, and none is transmitted.** The account is
 * created without a `passwordHash` and completed through the reset-token
 * flow — reusing `StaffUserSchema.passwordResetTokenHash`/`passwordResetExpiresAt`
 * rather than adding invite-specific fields, since "set my initial
 * password" and "reset my forgotten password" are the same completion
 * mechanism. Whoever creates the account never sees the credential.
 *
 * **This mints and stores the token; it does not complete the invitation.**
 * The invitee completes it at the public `POST /api/admin/auth/accept-invite`
 * (`acceptStaffInvite` in `server/admin/auth/staff-auth.ts`), which consumes
 * the token and sets the password; they then sign in at
 * `/api/admin/auth/login`. The rest of the `/api/admin/auth/**` surface —
 * `me`, `token/refresh`, `token/logout` — exists alongside it.
 */
export async function inviteStaff(dto: InviteStaffDto) {
  const email = dto.email.toLowerCase().trim();

  if (await staffUserRepository.findOne({ where: { email }, select: { _id: true }, skipThrowError: true })) {
    throw new ConflictError("A staff member with this email already exists.");
  }

  await assertRolesExist(dto.roleIds ?? []);

  const invitation = mintInvitation(new Date());

  try {
    const created = await staffUserRepository.save({
      name: dto.name.trim(),
      email,
      roles: (dto.roleIds ?? []).map((id) => new mongoose.Types.ObjectId(id)),
      passwordResetTokenHash: invitation.tokenHash,
      passwordResetExpiresAt: invitation.expiresAt,
    });

    await sendInvitation(email, invitation.token, dto.name.trim());

    // Re-read only to populate `roles` for the response — `save()` returns the unpopulated document.
    const staff = await staffUserRepository.findOne({ where: { _id: created._id }, relations: ["roles"] });
    return { ...staff, invitation: { token: invitation.token, expiresAt: invitation.expiresAt } };
  } catch (error) {
    if (error instanceof DuplicateKeyError) {
      throw new ConflictError("A staff member with this email already exists.");
    }
    throw error;
  }
}

/**
 * Re-mints the invitation for an account that has not activated yet — the
 * recovery for an expired or lost invitation. Replacing the stored hash
 * invalidates any earlier token. An activated account (one with a password)
 * is refused: re-inviting must never become a way to reset someone's
 * password.
 */
export async function reinviteStaff(staffId: string): Promise<StaffInvitation> {
  const invitation = mintInvitation(new Date());

  const updated = await staffUserRepository.updateAtomic(
    { _id: staffId, passwordHash: { $exists: false } },
    { $set: { passwordResetTokenHash: invitation.tokenHash, passwordResetExpiresAt: invitation.expiresAt } },
    { skipThrowError: true }
  );
  if (!updated) {
    const exists = await staffUserRepository.findOne({ where: { _id: staffId }, select: { _id: true }, skipThrowError: true });
    if (!exists) throw new NotFoundError("StaffUser was not found");
    throw new ConflictError("This staff member has already activated their account.");
  }

  await sendInvitation(updated.email, invitation.token, updated.name);
  return { token: invitation.token, expiresAt: invitation.expiresAt };
}
