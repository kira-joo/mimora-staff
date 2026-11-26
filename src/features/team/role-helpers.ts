import type { Role, RoleInput } from "src/api/roles.endpoints";

export interface RoleFormValues {
  name: string;
  isActive: boolean;
  grantsAll: boolean;
  permissionKeys: string[];
}

/** API shape → form values; no role → the create defaults. */
export function mapRoleToFormValues(oldData?: Role): RoleFormValues {
  return {
    name: oldData?.name ?? "",
    isActive: oldData?.isActive ?? true,
    grantsAll: oldData?.grantsAll ?? false,
    // Every key the role holds, including switched-off or no-longer-offered ones: the form sends the whole list back,
    // and a key missing from it would be removed. The matrix simply has no box for those.
    permissionKeys: (oldData?.permissions ?? []).map((permission) => permission.key).sort(),
  };
}

export function buildCreateRoleBody(values: RoleFormValues): RoleInput {
  return { name: values.name.trim(), isActive: values.isActive, grantsAll: values.grantsAll, permissionKeys: [...values.permissionKeys].sort() };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/** Only what changed — a no-op save sends `{}` and the server leaves the role untouched. */
export function buildUpdateRoleBody(oldData: Role, values: RoleFormValues): Partial<RoleInput> {
  const before = mapRoleToFormValues(oldData);
  const body: Partial<RoleInput> = {};
  if (values.name.trim() !== before.name) body.name = values.name.trim();
  if (values.isActive !== before.isActive) body.isActive = values.isActive;
  if (values.grantsAll !== before.grantsAll) body.grantsAll = values.grantsAll;
  if (!sameSet(values.permissionKeys, before.permissionKeys)) body.permissionKeys = [...values.permissionKeys].sort();
  return body;
}

/** "3 team members" / "1 team member" / "No one". */
export function memberLabel(count: number): string {
  if (count === 0) return "No one";
  return `${count} team member${count === 1 ? "" : "s"}`;
}
