/**
 * Who may hand out which access — the rule that stops privilege escalation.
 *
 * Holding `Role.update` or `StaffUser.update` must not be a ladder: without this rule, anyone who can edit roles could
 * add every permission to their own role, and anyone who can assign roles could make themselves an Owner. So a grant is
 * allowed only when the actor already holds everything it confers:
 *
 * - **full access (`grantsAll`)** can only be conferred by someone who has it;
 * - **a permission** can only be conferred by someone who holds it (or has full access);
 * - **a role or a person can only be changed by someone who covers their current access** — otherwise a Manager could
 *   strip the Owner, or rewrite a role more powerful than their own.
 *
 * Pure: the caller resolves the actor's roles (the request's `AuthUser`) and the access being granted.
 */

/** The shape of `AuthUser.roles` — only what this policy reads. */
export interface GrantingRole {
  grantsAll: boolean;
  permissions: readonly string[];
}

/** A bundle of access: a role, or the union of a person's roles. */
export interface AccessBundle {
  grantsAll: boolean;
  permissionKeys: readonly string[];
}

export interface ActorAccess {
  grantsAll: boolean;
  keys: ReadonlySet<string>;
}

/** The actor's effective access — the union of their (already active-filtered) roles. */
export function actorAccess(roles: readonly GrantingRole[]): ActorAccess {
  return {
    grantsAll: roles.some((role) => role.grantsAll),
    keys: new Set(roles.flatMap((role) => role.permissions)),
  };
}

/** The union of several bundles — e.g. the roles about to be assigned to one person. */
export function combineAccess(bundles: readonly AccessBundle[]): AccessBundle {
  return {
    grantsAll: bundles.some((bundle) => bundle.grantsAll),
    permissionKeys: [...new Set(bundles.flatMap((bundle) => bundle.permissionKeys))],
  };
}

/** The permission keys in `bundle` the actor could not grant — empty when the grant is allowed (ignoring `grantsAll`). */
export function ungrantableKeys(actor: ActorAccess, bundle: AccessBundle): string[] {
  if (actor.grantsAll) return [];
  return [...new Set(bundle.permissionKeys)].filter((key) => !actor.keys.has(key)).sort();
}

/** Whether the actor holds everything `bundle` confers. */
export function covers(actor: ActorAccess, bundle: AccessBundle): boolean {
  if (actor.grantsAll) return true;
  if (bundle.grantsAll) return false;
  return ungrantableKeys(actor, bundle).length === 0;
}

export type GrantRefusal = { reason: "grantsAll" } | { reason: "permissions"; keys: string[] };

/** Why the actor may not confer `bundle`, or `null` when they may. */
export function grantRefusal(actor: ActorAccess, bundle: AccessBundle): GrantRefusal | null {
  if (actor.grantsAll) return null;
  if (bundle.grantsAll) return { reason: "grantsAll" };
  const keys = ungrantableKeys(actor, bundle);
  return keys.length > 0 ? { reason: "permissions", keys } : null;
}
