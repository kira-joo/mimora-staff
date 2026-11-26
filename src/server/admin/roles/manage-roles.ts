import { BadRequestError, ConflictError } from "@kira-joo/backend-toolkit-core";
import { escapeRegExp } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { permissionRepository, roleRepository, staffUserRepository } from "../../core/repositories";
import { StaffUserModel } from "../../identity/staff-user.schema";
import { ASSIGNABLE_PERMISSION_KEYS } from "../../../common/authorization/permission-catalog";
import { OWNER_ROLE_NAME, assertRoleEditKeepsAnOwner, withOwnerGuard } from "../staff/owner-invariant";
import { assertCanGrant, bundleOf, loadActorAccess, type RequestActor } from "./role-access";
import { AppPermission } from "../../../common/authorization/authorization-registry";
import type { CreateRoleDto, UpdateRoleDto } from "../dto/role.dto";

/**
 * Role CRUD. Every write is checked three ways, server-side:
 *
 * 1. **The grant policy** — the actor may only create, edit or delete a role whose access (before AND after the edit)
 *    they hold themselves; full access only by someone who has it. Holding `Role.update` is not a ladder.
 * 2. **The Owner invariant** — the store always keeps an active staff member with an active full-access role. The
 *    default Owner role can be neither renamed, deactivated, stripped of full access, nor deleted; any edit that turns
 *    full access off runs inside `withOwnerGuard` so it serialises with staff demotions.
 * 3. **Integrity** — names are unique (case-insensitive), permissions are named by key and must be real, active and
 *    assignable, and a role still held by anyone cannot be deleted.
 *
 * Permission edits take effect on each holder's very next request: `resolveStaffUser` re-reads roles every time.
 */

export interface RoleView {
  _id: string;
  name: string;
  grantsAll: boolean;
  isActive: boolean;
  permissions: Array<{ _id: string; key: string; entity: string; action: string; name: string; isActive: boolean; isSystem: boolean }>;
  /** Team members holding this role (active or not). */
  memberCount: number;
  /** Of those, how many can sign in. */
  activeMemberCount: number;
  /** The default Owner role: always full access, never renamed or deleted. */
  isOwnerRole: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

type StoredRole = Omit<RoleView, "memberCount" | "activeMemberCount" | "isOwnerRole" | "_id" | "permissions"> & {
  _id: mongoose.Types.ObjectId;
  permissions: Array<(RoleView["permissions"][number] & { _id: mongoose.Types.ObjectId }) | null>;
};

async function memberCounts(roleIds?: mongoose.Types.ObjectId[]): Promise<Map<string, { total: number; active: number }>> {
  const rows = await StaffUserModel.aggregate<{ _id: mongoose.Types.ObjectId; total: number; active: number }>([
    ...(roleIds ? [{ $match: { roles: { $in: roleIds } } }] : []),
    { $unwind: "$roles" },
    ...(roleIds ? [{ $match: { roles: { $in: roleIds } } }] : []),
    { $group: { _id: "$roles", total: { $sum: 1 }, active: { $sum: { $cond: ["$active", 1, 0] } } } },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), { total: row.total, active: row.active }]));
}

function toView(role: StoredRole, counts: Map<string, { total: number; active: number }>): RoleView {
  const count = counts.get(role._id.toString()) ?? { total: 0, active: 0 };
  return {
    _id: role._id.toString(),
    name: role.name,
    grantsAll: role.grantsAll,
    isActive: role.isActive,
    permissions: role.permissions.flatMap((permission) => (permission ? [{ ...permission, _id: permission._id.toString() }] : [])),
    memberCount: count.total,
    activeMemberCount: count.active,
    isOwnerRole: role.name === OWNER_ROLE_NAME,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

/** Every role (they are few), Owner first then A–Z, each with its member counts. */
export async function listRoles(): Promise<RoleView[]> {
  const roles = (await roleRepository.findAll({ relations: ["permissions"], lean: true })) as unknown as StoredRole[];
  const counts = await memberCounts();
  return roles
    .map((role) => toView(role, counts))
    .sort((a, b) => Number(b.isOwnerRole) - Number(a.isOwnerRole) || a.name.localeCompare(b.name));
}

export async function getRole(roleId: string): Promise<RoleView> {
  const role = (await roleRepository.findOne({ where: { _id: new mongoose.Types.ObjectId(roleId) }, relations: ["permissions"], lean: true })) as unknown as StoredRole;
  return toView(role, await memberCounts([role._id]));
}

/**
 * Keys → Permission ids. A key the role ALREADY holds is kept as it is even when it is no longer offered (a default
 * role may hold a key no route enforces any more, e.g. `Order.cancel`): an edit must not fail, nor silently strip it.
 * Any key being ADDED must be in the assignable vocabulary and stored active.
 */
async function resolvePermissionIds(keys: readonly string[], alreadyHeld: ReadonlyMap<string, mongoose.Types.ObjectId> = new Map()): Promise<mongoose.Types.ObjectId[]> {
  const unique = [...new Set(keys)];
  const kept = unique.filter((key) => alreadyHeld.has(key));
  const added = unique.filter((key) => !alreadyHeld.has(key));
  const unknown = added.filter((key) => !ASSIGNABLE_PERMISSION_KEYS.has(key));
  if (unknown.length > 0) throw new BadRequestError(`Unknown permission: ${unknown.slice(0, 5).join(", ")}.`);
  const keptIds = kept.map((key) => alreadyHeld.get(key)!);
  if (added.length === 0) return keptIds;
  const stored = (await permissionRepository.findAll({ where: { key: { $in: added }, isActive: true }, select: { _id: true, key: true } })) as unknown as Array<{
    _id: mongoose.Types.ObjectId;
    key: string;
  }>;
  if (stored.length !== added.length) {
    const found = new Set(stored.map((permission) => permission.key));
    throw new BadRequestError(`Permission not available: ${added.filter((key) => !found.has(key)).slice(0, 5).join(", ")}.`);
  }
  return [...keptIds, ...stored.map((permission) => permission._id)];
}

async function assertNameFree(name: string, exceptRoleId?: string): Promise<void> {
  const clash = await roleRepository.findOne({
    where: {
      name: { $regex: `^${escapeRegExp(name)}$`, $options: "i" },
      ...(exceptRoleId ? { _id: { $ne: new mongoose.Types.ObjectId(exceptRoleId) } } : {}),
    },
    select: { _id: true },
    skipThrowError: true,
  });
  if (clash) throw new ConflictError(`A role named "${name}" already exists.`);
}

const canonicalId = (id: string) => new mongoose.Types.ObjectId(id).toHexString();

/*
 * Every write below runs inside `withOwnerGuard` — the same serialised transaction staff assignments, invitations and
 * direct creation take — and re-reads the actor's access there. So a role cannot be widened between someone's
 * "may I assign this role?" check and their write, nor deleted under an assignment in flight.
 */

export async function createRole(dto: CreateRoleDto, actor: RequestActor): Promise<RoleView> {
  const name = dto.name.trim();
  const grantsAll = dto.grantsAll ?? false;
  const created = await withOwnerGuard(async () => {
    assertCanGrant(await loadActorAccess(actor, AppPermission.ROLE.CREATE), { grantsAll, permissionKeys: dto.permissionKeys }, "create a role with");
    await assertNameFree(name);
    const permissions = await resolvePermissionIds(dto.permissionKeys);
    return roleRepository.save({ name, grantsAll, isActive: dto.isActive ?? true, permissions } as never);
  });
  return getRole(String((created as unknown as { _id: unknown })._id));
}

export async function updateRole(rawRoleId: string, dto: UpdateRoleDto, actor: RequestActor): Promise<RoleView> {
  const roleId = canonicalId(rawRoleId);
  await withOwnerGuard(async () => {
    const access = await loadActorAccess(actor, AppPermission.ROLE.UPDATE);
    const current = (await roleRepository.findOne({ where: { _id: new mongoose.Types.ObjectId(roleId) }, relations: ["permissions"], lean: true })) as unknown as StoredRole;

    // You may not edit a role more powerful than yourself — nor turn it into one.
    assertCanGrant(access, bundleOf(current), "edit a role with");
    const held = new Map(current.permissions.flatMap((permission) => (permission ? [[permission.key, permission._id] as const] : [])));
    if (dto.permissionKeys !== undefined || dto.grantsAll !== undefined) {
      const nextKeys = dto.permissionKeys ?? bundleOf(current).permissionKeys;
      // Only what is being ADDED needs the actor's cover; keeping a key the role already had grants nothing new.
      assertCanGrant(access, { grantsAll: dto.grantsAll ?? current.grantsAll, permissionKeys: nextKeys.filter((key) => !held.has(key)) }, "give a role");
    }

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined && dto.name.trim() !== current.name) {
      if (current.name === OWNER_ROLE_NAME) throw new ConflictError(`The ${OWNER_ROLE_NAME} role can't be renamed.`);
      await assertNameFree(dto.name.trim(), roleId);
      patch.name = dto.name.trim();
    }
    if (dto.permissionKeys !== undefined) patch.permissions = await resolvePermissionIds(dto.permissionKeys, held);
    if (dto.grantsAll !== undefined) patch.grantsAll = dto.grantsAll;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    if (Object.keys(patch).length === 0) return null;

    // Turning full access off (or deactivating) could leave no Owner: checked here, in the same serialised unit.
    await assertRoleEditKeepsAnOwner(roleId, { grantsAll: dto.grantsAll, isActive: dto.isActive });
    return roleRepository.updateAtomic({ _id: new mongoose.Types.ObjectId(roleId) }, { $set: patch });
  });
  return getRole(roleId);
}

/** Deletes a role nobody holds. Returns the deleted role as it was, for the audit trail. */
export async function deleteRole(rawRoleId: string, actor: RequestActor): Promise<RoleView> {
  const roleId = canonicalId(rawRoleId);
  const before = await getRole(roleId);
  if (before.isOwnerRole) throw new ConflictError(`The ${OWNER_ROLE_NAME} role can't be deleted.`);

  await withOwnerGuard(async () => {
    const current = (await roleRepository.findOne({ where: { _id: new mongoose.Types.ObjectId(roleId) }, relations: ["permissions"], lean: true })) as unknown as StoredRole;
    assertCanGrant(await loadActorAccess(actor, AppPermission.ROLE.DELETE), bundleOf(current), "delete a role with");
    const holders = await staffUserRepository.count({ where: { roles: new mongoose.Types.ObjectId(roleId) } });
    if (holders > 0) {
      throw new ConflictError(`${holders} team member${holders === 1 ? " has" : "s have"} this role. Give them another role first, then delete it.`);
    }
    // Throws NotFoundError if a concurrent delete got there first.
    return roleRepository.delete({ where: { _id: new mongoose.Types.ObjectId(roleId) } });
  });
  return before;
}
