import { ConflictError } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";
import { revokeAllForSubject } from "@kira-joo/backend-toolkit-mongoose";
import { staffUserRepository } from "../../core/repositories";
import { StaffRefreshTokenModel } from "../../identity/staff-refresh-token.schema";
import { assertRolesExist } from "../../identity/assert-roles-exist";
import { LAST_OWNER_MESSAGE, activeOwnerRoleIds, countActiveOwners, withOwnerGuard } from "./owner-invariant";
import type { UpdateStaffDto } from "../dto/update-staff.dto";

export interface UpdateStaffInput {
  staffId: string;
  actingStaffId: string;
  body: UpdateStaffDto;
}

/**
 * Updates a staff member's name, roles, or active flag. MDS §18: "Staff
 * list, invite, role assignment, deactivate" — all three of those last
 * verbs are this one `PUT`, matching `restaurant-platform-staff`'s own
 * staff-edit route shape.
 *
 * **Role changes and deactivation both take effect immediately.**
 * `tokenVersion` is bumped whenever either changes, and `resolveStaffUser`
 * reads the JWT's `tokenVersion` claim against the stored value on every
 * request — so a staff member who just had permissions REDUCED does not
 * keep the old ones for the rest of their access-token's lifetime. A
 * plain name edit does not bump it: that would sign out a colleague mid-task
 * for a change with nothing to do with their session.
 *
 * **You cannot deactivate yourself.** The only way to lock every
 * administrator out is one person doing it to themselves by accident —
 * refused rather than warned about.
 *
 * **The last active Owner cannot be demoted or deactivated — by anyone,
 * themselves included.** An "Owner" is a staff member who is active and holds an
 * active full-access role (`grantsAll`), the same rule that grants the access.
 * An update that would stop the target being one is refused (409) when no other
 * active Owner remains: otherwise one careless role edit leaves a store nobody
 * can administer, and permissions can only be re-granted by an Owner. The check
 * is a read followed by a write, so two Owners demoting each other in the same
 * instant would both pass it, so the check and the write run in ONE transaction
 * that first writes a shared lock document (`withOwnerGuard`): concurrent
 * demotions write-conflict, and the loser re-counts after the winner commits.
 *
 * **There is no DELETE.** Staff appear as actors on order timelines and in
 * the activity log; deactivation is the removal.
 */
export async function updateStaff({ staffId, actingStaffId, body }: UpdateStaffInput) {
  if (body.active === false && staffId === actingStaffId) {
    throw new ConflictError("You cannot deactivate your own account.");
  }

  if (body.roleIds !== undefined) await assertRolesExist(body.roleIds);

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.active !== undefined) patch.active = body.active;
  if (body.roleIds !== undefined) {
    patch.roles = body.roleIds.map((id) => new mongoose.Types.ObjectId(id));
  }

  const invalidatesSessions = body.roleIds !== undefined || body.active !== undefined;
  const write = () =>
    staffUserRepository.updateAtomic({ _id: staffId }, invalidatesSessions ? { $set: patch, $inc: { tokenVersion: 1 } } : { $set: patch });

  // A name edit cannot affect who is an Owner, so it neither needs nor takes the lock.
  const updated = invalidatesSessions
    ? await withOwnerGuard(async () => {
        await assertNotLastOwnerLoss(staffId, body);
        return write();
      })
    : await write();

  // The tokenVersion bump kills outstanding access tokens; revoking the
  // refresh families stops them being renewed, as the reference does.
  // After the commit, not inside it: the transaction can be retried.
  if (invalidatesSessions) await revokeAllForSubject(StaffRefreshTokenModel, updated._id);

  // Re-read only to populate `roles` for the response — `updateAtomic()` returns the unpopulated document.
  return staffUserRepository.findOne({ where: { _id: staffId }, relations: ["roles"] });
}

/** Throws if this update would leave the system with no active Owner. Runs inside `withOwnerGuard`. */
async function assertNotLastOwnerLoss(staffId: string, body: UpdateStaffDto): Promise<void> {
  if (body.active === undefined && body.roleIds === undefined) return;

  const ownerRoleIds = await activeOwnerRoleIds();
  if (ownerRoleIds.length === 0) return;
  const ownerRoleIdStrings = ownerRoleIds.map((id) => id.toString());

  const target = await staffUserRepository.findOne({ where: { _id: staffId }, lean: true });
  const holdsOwnerRole = (roles: Iterable<{ toString(): string }>) => [...roles].some((role) => ownerRoleIdStrings.includes(role.toString()));

  const isOwnerNow = target.active && holdsOwnerRole(target.roles);
  const staysOwner = (body.active ?? target.active) && holdsOwnerRole(body.roleIds ?? target.roles);
  if (!isOwnerNow || staysOwner) return;

  if ((await countActiveOwners(ownerRoleIds, staffId)) === 0) throw new ConflictError(LAST_OWNER_MESSAGE);
}
