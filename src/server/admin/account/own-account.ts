import { BadRequestError, UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import { buildRolePopulateRelations, revokeAllForSubject } from "@kira-joo/backend-toolkit-mongoose";
import { comparePassword, hashPassword } from "@kira-joo/backend-toolkit-next";
import mongoose from "mongoose";
import { staffUserRepository } from "../../core/repositories";
import { StaffUserModel } from "../../identity/staff-user.schema";
import { StaffRefreshTokenModel } from "../../identity/staff-refresh-token.schema";
import { issueStaffSession } from "../auth/staff-auth";

/**
 * The signed-in staff member's own account. Every function takes the id of the AUTHENTICATED user (the route passes
 * `user._id`) and never an id from the request, so this surface can only ever touch the caller's own record. Changing
 * someone else is `/api/admin/staff/:id`, behind its own permissions.
 */

export interface OwnAccountRole {
  _id: string;
  name: string;
  grantsAll: boolean;
  isActive: boolean;
  permissions: Array<{ key: string; name: string; entity: string; action: string; isSystem: boolean }>;
}

export interface OwnAccount {
  _id: string;
  name: string;
  email: string;
  roles: OwnAccountRole[];
  /** True when any active role grants full access. */
  grantsAll: boolean;
  /** Every permission key the active roles grant (empty while a password change is pending — see `mustChangePassword`). */
  effectivePermissions: string[];
  mustChangePassword: boolean;
  lastLoginAt?: Date;
  createdAt?: Date;
}

type PopulatedRole = { _id: mongoose.Types.ObjectId; name: string; grantsAll: boolean; isActive: boolean; permissions: Array<(OwnAccountRole["permissions"][number] & { isActive: boolean }) | null> };

export async function getOwnAccount(userId: string): Promise<OwnAccount> {
  const user = await staffUserRepository.findOne({ where: { _id: new mongoose.Types.ObjectId(userId) }, relations: buildRolePopulateRelations("roles") });
  const roles = (user.roles as unknown as PopulatedRole[]).map((role) => ({
    _id: role._id.toString(),
    name: role.name,
    grantsAll: role.grantsAll,
    isActive: role.isActive,
    permissions: role.permissions.flatMap((permission) =>
      permission && permission.isActive ? [{ key: permission.key, name: permission.name, entity: permission.entity, action: permission.action, isSystem: permission.isSystem }] : []
    ),
  }));
  const mustChangePassword = user.mustChangePassword === true;
  const active = mustChangePassword ? [] : roles.filter((role) => role.isActive);
  return {
    _id: user._id.toString(),
    name: user.name,
    email: user.email,
    roles,
    grantsAll: active.some((role) => role.grantsAll),
    effectivePermissions: [...new Set(active.flatMap((role) => role.permissions.map((permission) => permission.key)))].sort(),
    mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: (user as unknown as { createdAt?: Date }).createdAt,
  };
}

/** A display-name change. Does not touch the session. */
export async function updateOwnAccount(userId: string, input: { name: string }): Promise<OwnAccount> {
  await staffUserRepository.updateAtomic({ _id: new mongoose.Types.ObjectId(userId) }, { $set: { name: input.name.trim() } });
  return getOwnAccount(userId);
}

const WRONG_CURRENT_PASSWORD = "Your current password is not correct.";

/**
 * Replaces the caller's password after proving they know the current one — a stolen session alone must not be enough
 * to lock the owner out. On success, in this order:
 *
 * 1. the new hash is written, `mustChangePassword` cleared, `tokenVersion` bumped and `sessionsValidFrom` set, in ONE
 *    atomic update that also re-checks the account is active and still has the hash just verified (so a concurrent
 *    change cannot be lost) — `sessionsValidFrom` makes a refresh family started earlier unrenewable even if a
 *    rotation in flight slips its successor past step 2;
 * 2. every refresh-token family is revoked — every other device is signed out;
 * 3. a fresh session is issued for THIS device, so the person who just changed it stays signed in.
 *
 * The route rate-limits attempts per account; a wrong current password is a 400 with a field-shaped message, not a
 * 401 (that would read as "your session ended" to the console's refresh logic).
 */
export async function changeOwnPassword(userId: string, input: { currentPassword: string; newPassword: string }): Promise<void> {
  const _id = new mongoose.Types.ObjectId(userId);
  const record = await StaffUserModel.findOne({ _id, active: true }).select("+passwordHash").lean<{ _id: mongoose.Types.ObjectId; passwordHash?: string }>();
  if (!record?.passwordHash) throw new UnauthorizedError();
  if (!(await comparePassword(input.currentPassword, record.passwordHash))) throw new BadRequestError(WRONG_CURRENT_PASSWORD);
  if (input.newPassword === input.currentPassword) throw new BadRequestError("Choose a new password that is different from the current one.");

  const passwordHash = await hashPassword(input.newPassword);
  const updated = await staffUserRepository.updateAtomic(
    { _id, active: true, passwordHash: record.passwordHash },
    { $set: { passwordHash, sessionsValidFrom: new Date() }, $unset: { mustChangePassword: "" }, $inc: { tokenVersion: 1 } },
    { skipThrowError: true }
  );
  // The hash changed between the check and the write: another change won. Ask them to try again with the new one.
  if (!updated) throw new BadRequestError(WRONG_CURRENT_PASSWORD);

  await revokeAllForSubject(StaffRefreshTokenModel, _id);
  await issueStaffSession({ _id, tokenVersion: updated.tokenVersion });
}
