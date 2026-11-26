import { BadRequestError, ForbiddenError, type AuthUser } from "@kira-joo/backend-toolkit-core";
import { buildRolePopulateRelations } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { roleRepository, staffUserRepository } from "../../core/repositories";
import { resolveStaffUser } from "../../core/auth/resolve-staff-user";
import { actorAccess, combineAccess, covers, grantRefusal, type AccessBundle, type ActorAccess } from "../../engines/authorization/grant-policy";

/**
 * The database side of the grant policy (`engines/authorization/grant-policy.ts`): resolves what a role or a person
 * confers, and refuses — with a message naming what is missing — any change the acting staff member could not make
 * themselves. Every role write and every role assignment goes through here.
 *
 * A role is judged by what it WOULD confer, active or not: an inactive role is still a loaded weapon — whoever
 * re-activates it hands out everything on it — so assigning one is judged as if it were active.
 */

type PopulatedRole = { _id: unknown; name: string; grantsAll: boolean; isActive: boolean; permissions: Array<{ key: string; isActive: boolean } | null> };

export function bundleOf(role: { grantsAll: boolean; permissions: Array<{ key: string; isActive?: boolean } | null> }): AccessBundle {
  return {
    grantsAll: role.grantsAll,
    permissionKeys: role.permissions.flatMap((permission) => (permission && permission.isActive !== false ? [permission.key] : [])),
  };
}

/** The acting staff member's access, from an already-resolved `AuthUser` (inactive roles/permissions dropped). */
export function accessOf(actor: Pick<AuthUser, "roles">): ActorAccess {
  return actorAccess(actor.roles);
}

/** What the grant policy needs to know about the person making a request: who, which session, what it was granted. */
export type RequestActor = Pick<AuthUser, "_id" | "tokenVersion" | "roles">;

/**
 * The acting staff member's access for a write inside `withOwnerGuard` — the INTERSECTION of what their request was
 * authenticated with and what the database holds now:
 *
 * - **now**, so a narrowing committed after the request was authenticated (a role trimmed, the actor demoted) counts;
 * - **the request's**, so a WIDENING committed in between does not: a request authenticated before the actor was made
 *   an Owner must not act with Owner access it never had;
 * - the session must still be current (`tokenVersion`: a role change or deactivation ends it), and the actor must still
 *   hold the route's own permission (`requiredPermission`) — otherwise a queued request outlives its authorisation.
 *
 * A deactivated, password-pending or signed-out actor is refused.
 */
export async function loadActorAccess(actor: RequestActor, requiredPermission: string): Promise<ActorAccess> {
  const current = await resolveStaffUser(actor._id);
  if (!current || current.tokenVersion !== actor.tokenVersion) throw new ForbiddenError("Your access changed while this was being saved. Reload and try again.");
  const now = accessOf(current);
  const then = accessOf(actor);
  const access = intersectAccess(then, now);
  if (!access.grantsAll && !access.keys.has(requiredPermission)) throw new ForbiddenError("You no longer have permission to do this.");
  return access;
}

/** Access both sides hold: full access only if both have it; otherwise the keys both have (full access holds every key). */
export function intersectAccess(a: ActorAccess, b: ActorAccess): ActorAccess {
  if (a.grantsAll && b.grantsAll) return { grantsAll: true, keys: new Set() };
  if (a.grantsAll) return { grantsAll: false, keys: new Set(b.keys) };
  if (b.grantsAll) return { grantsAll: false, keys: new Set(a.keys) };
  return { grantsAll: false, keys: new Set([...a.keys].filter((key) => b.keys.has(key))) };
}

/** Loads roles with their permissions populated. Throws 400 when an id names no role. */
export async function loadRoles(roleIds: readonly string[]): Promise<PopulatedRole[]> {
  const unique = [...new Set(roleIds)];
  if (unique.length === 0) return [];
  const roles = (await roleRepository.findByIds(unique, { relations: ["permissions"] })) as unknown as PopulatedRole[];
  if (roles.length !== unique.length) throw new BadRequestError("One or more roles do not exist.");
  return roles;
}

export function refusalMessage(subject: string, refusal: NonNullable<ReturnType<typeof grantRefusal>>): string {
  if (refusal.reason === "grantsAll") return `Only someone with full access can ${subject} full access.`;
  const listed = refusal.keys.slice(0, 5).join(", ");
  const more = refusal.keys.length > 5 ? ` and ${refusal.keys.length - 5} more` : "";
  return `You can only ${subject} permissions you hold yourself. Missing: ${listed}${more}.`;
}

/** 403 unless the actor holds everything `bundle` confers. */
export function assertCanGrant(actor: ActorAccess, bundle: AccessBundle, subject = "grant"): void {
  const refusal = grantRefusal(actor, bundle);
  if (refusal) throw new ForbiddenError(refusalMessage(subject, refusal));
}

/** 403 unless the actor could grant every role in `roleIds` (judged together). */
export async function assertCanAssignRoles(actor: ActorAccess, roleIds: readonly string[]): Promise<void> {
  const roles = await loadRoles(roleIds);
  assertCanGrant(actor, combineAccess(roles.map(bundleOf)), "assign roles with");
}

/**
 * 403 unless the actor covers the target person's CURRENT access. Without it, someone allowed to edit staff could
 * strip, rename or deactivate a colleague more powerful than themselves — an Owner, for instance.
 */
export async function assertCanManageStaff(actor: ActorAccess, staffId: string): Promise<void> {
  if (actor.grantsAll) return;
  const target = await staffUserRepository.findOne({
    where: { _id: new mongoose.Types.ObjectId(staffId) },
    relations: buildRolePopulateRelations("roles"),
  });
  const bundle = combineAccess((target.roles as unknown as PopulatedRole[]).map(bundleOf));
  if (!covers(actor, bundle)) throw new ForbiddenError("You can't change a team member who has access you don't have.");
}
