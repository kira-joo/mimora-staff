import { BadRequestError } from "@kira-joo/backend-toolkit-core";
import { roleRepository } from "../core/repositories";

/**
 * `@IsMongoId()` on `InviteStaffDto.roleIds`/`UpdateStaffDto.roleIds` only
 * checks the shape of an id, not that it names a real `Role` document — a
 * well-formed id for a role that doesn't exist would otherwise be stored,
 * populate to nothing, and silently grant the staff member zero permissions
 * from that slot.
 */
export async function assertRolesExist(roleIds: string[]): Promise<void> {
  if (roleIds.length === 0) return;

  const found = await roleRepository.findByIds(roleIds, { select: { _id: true } });
  if (found.length !== new Set(roleIds).size) {
    throw new BadRequestError("One or more roles do not exist.");
  }
}
