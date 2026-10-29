import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { roleRepository, staffOwnerLockRepository, staffUserRepository } from "../../core/repositories";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";

/**
 * The invariant: the store always has at least one ACTIVE staff member holding an ACTIVE full-access (`grantsAll`)
 * role — an "Owner". Only an Owner can grant permissions, so a store that loses its last one cannot be administered
 * again except through the `bootstrap-owner` script.
 *
 * Every change that can break it — a staff demotion or deactivation (`updateStaff`), and any edit of a role
 * (`assertRoleEditKeepsAnOwner`) — checks it inside {@link withOwnerGuard}, so the check and the write it protects are
 * one serialised unit.
 */
export const OWNER_LOCK_KEY = "staff-owners";

/** The default Owner role's name. Its `grantsAll` is not editable: renaming the concept away would defeat the guard. */
export const OWNER_ROLE_NAME = "Owner";

/**
 * Runs `work` in one transaction that first WRITES the shared owner lock, so two concurrent owner-affecting changes
 * write-conflict instead of both passing a read-then-write check against the same snapshot (write skew — see
 * `StaffOwnerLockSchema`). The driver retries the loser; its retry re-reads and re-counts after the winner commits.
 * A thrown {@link ConflictError} aborts the transaction and surfaces as the 409 it is.
 *
 * `work` runs inside a transaction that can be retried, so it must be idempotent and perform no external I/O. It must
 * use repositories (which join the ambient session), not raw models.
 */
export function withOwnerGuard<T>(work: () => Promise<T>): Promise<T> {
  return withTransaction(
    async (tx) => {
      // The loser of a conflict must still be standing when the winner commits, or its budget burns in milliseconds.
      await backOffBeforeRetry(tx.attempt);
      await staffOwnerLockRepository.updateAtomic({ key: OWNER_LOCK_KEY }, { $inc: { version: 1 } }, { upsert: true });
      return tx.complete(await work());
    },
    { maxRetries: CONTENDED_MAX_RETRIES }
  );
}

/** Ids of the roles that currently make their holders Owners. Call inside {@link withOwnerGuard}. */
export async function activeOwnerRoleIds(): Promise<mongoose.Types.ObjectId[]> {
  const roles = await roleRepository.findAll({ where: { grantsAll: true, isActive: true }, select: { _id: true } });
  return roles.map((role) => new mongoose.Types.ObjectId(String((role as unknown as { _id: unknown })._id)));
}

/** Active staff holding at least one of `ownerRoleIds`, optionally not counting one member. Call inside {@link withOwnerGuard}. */
export function countActiveOwners(ownerRoleIds: mongoose.Types.ObjectId[], excludeStaffId?: string): Promise<number> {
  if (ownerRoleIds.length === 0) return Promise.resolve(0);
  return staffUserRepository.count({
    where: {
      ...(excludeStaffId ? { _id: { $ne: new mongoose.Types.ObjectId(excludeStaffId) } } : {}),
      active: true,
      roles: { $in: ownerRoleIds },
    },
  });
}

export const LAST_OWNER_MESSAGE = "This is the last active Owner. Make another staff member an Owner first — the store must always have one.";

export interface RoleEditPatch {
  grantsAll?: boolean;
  isActive?: boolean;
}

/**
 * Refuses a role edit that would break the invariant. Call inside {@link withOwnerGuard}, with the role's id and the
 * fields the edit sets, BEFORE writing them:
 *
 * - the default **Owner** role can never lose `grantsAll` (nor be deactivated) — it is what "Owner" means here;
 * - no edit may make a role stop being full-access (`grantsAll` off, or deactivated) when that leaves zero active staff
 *   holding any OTHER active full-access role.
 *
 * Permission-list edits that leave `grantsAll` and `isActive` alone cannot break the invariant and are always allowed.
 *
 * **There is no role-edit route today** (`/api/admin/roles` is read-only by a deliberate v1 scope decision), so nothing
 * calls this yet. It exists so the day a role write path is added it is born guarded; that route must call this inside
 * {@link withOwnerGuard}, in the same transaction as the write, or the guard is advisory.
 */
export async function assertRoleEditKeepsAnOwner(roleId: string, patch: RoleEditPatch): Promise<void> {
  if (patch.grantsAll === undefined && patch.isActive === undefined) return;

  const role = await roleRepository.findOne({ where: { _id: new mongoose.Types.ObjectId(roleId) }, lean: true });
  const grantsAllAfter = patch.grantsAll ?? role.grantsAll;
  const activeAfter = patch.isActive ?? role.isActive;

  if (role.name === OWNER_ROLE_NAME && (!grantsAllAfter || !activeAfter)) {
    throw new ConflictError(`The ${OWNER_ROLE_NAME} role always grants full access and cannot be turned off.`);
  }

  const isOwnerRoleNow = role.grantsAll && role.isActive;
  const isOwnerRoleAfter = grantsAllAfter && activeAfter;
  if (!isOwnerRoleNow || isOwnerRoleAfter) return;

  const otherOwnerRoles = (await activeOwnerRoleIds()).filter((id) => id.toString() !== roleId);
  if ((await countActiveOwners(otherOwnerRoles)) === 0) throw new ConflictError(LAST_OWNER_MESSAGE);
}
