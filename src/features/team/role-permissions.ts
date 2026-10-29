import type { RolePermission } from "src/api/roles.endpoints";

export interface PermissionGroup {
  entity: string;
  items: { key: string; label: string }[];
}

const CRUD_LABEL: Record<string, string> = { read: "View list", readOne: "View one", create: "Create", update: "Edit", delete: "Delete" };

/** "StaffUser" → "Staff user". */
export function humanizeEntity(entity: string): string {
  const spaced = entity.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Groups a role's permissions by entity; generated CRUD keys read as verbs, hand-made ones keep their own name. Entities sort A–Z. */
export function groupPermissions(permissions: RolePermission[]): PermissionGroup[] {
  const groups = new Map<string, PermissionGroup>();
  for (const permission of permissions) {
    const group = groups.get(permission.entity) ?? { entity: permission.entity, items: [] };
    group.items.push({ key: permission.key, label: permission.isSystem ? (CRUD_LABEL[permission.action] ?? permission.name) : permission.name });
    groups.set(permission.entity, group);
  }
  return [...groups.values()].sort((a, b) => a.entity.localeCompare(b.entity));
}
