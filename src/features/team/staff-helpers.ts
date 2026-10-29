import type { InviteStaffInput, StaffMember, UpdateStaffInput } from "src/api/staff.endpoints";

export interface StaffFormValues {
  name: string;
  email: string;
  roleIds: string[];
  active: boolean;
}

/** API shape → form values; no member → the invite defaults. */
export function mapStaffToFormValues(oldData?: StaffMember): StaffFormValues {
  return {
    name: oldData?.name ?? "",
    email: oldData?.email ?? "",
    roleIds: oldData?.roles.map((role) => role._id) ?? [],
    active: oldData?.active ?? true,
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

export function buildInviteBody(values: StaffFormValues): InviteStaffInput {
  return { name: values.name.trim(), email: values.email.trim(), roleIds: values.roleIds };
}

/**
 * Only what changed. The API bumps the person's `tokenVersion` (signing them out
 * everywhere) whenever `roleIds` or `active` is present — even when the value is
 * unchanged — so an untouched field must be left out, not re-sent.
 */
export function buildUpdateBody(oldData: StaffMember, values: StaffFormValues): UpdateStaffInput {
  const before = mapStaffToFormValues(oldData);
  const body: UpdateStaffInput = {};
  if (values.name.trim() !== before.name) body.name = values.name.trim();
  if (!sameSet(values.roleIds, before.roleIds)) body.roleIds = values.roleIds;
  if (values.active !== before.active) body.active = values.active;
  return body;
}

/** What saving this change does to the person's session, for the confirm. `null` when it signs nobody out. */
export function sessionImpact(body: UpdateStaffInput): { title: (name: string) => string; description: (name: string) => string; confirmLabel: string; destructive: boolean } | null {
  const roles = body.roleIds !== undefined;
  const deactivating = body.active === false;
  const reactivating = body.active === true;
  if (!roles && !deactivating && !reactivating) return null;
  if (deactivating) {
    return {
      title: (name) => `Deactivate ${name}?`,
      description: (name) =>
        `${name} is signed out of every session right away and cannot sign in again until you reactivate the account.${roles ? " Their roles change too." : ""}`,
      confirmLabel: "Deactivate and sign out",
      destructive: true,
    };
  }
  return {
    title: (name) => (roles ? `Change ${name}'s roles?` : `Reactivate ${name}?`),
    description: (name) =>
      roles
        ? `${name} is signed out of every session right away. They sign in again with the new access.`
        : `${name} can sign in again. Any earlier session was already ended, so they sign in fresh.`,
    confirmLabel: roles ? "Change roles and sign out" : "Reactivate",
    destructive: roles,
  };
}
