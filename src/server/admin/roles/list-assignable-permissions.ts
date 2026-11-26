import { permissionRepository } from "../../core/repositories";
import { ASSIGNABLE_PERMISSION_KEYS } from "../../../common/authorization/permission-catalog";

export interface AssignablePermission {
  _id: string;
  key: string;
  entity: string;
  action: string;
  name: string;
  isSystem: boolean;
}

/**
 * Active stored permissions that some admin route actually enforces. Keys no route checks are left out (a checkbox
 * that guards nothing would mislead), as are stale keys the code no longer defines — both are still stored, never
 * deleted, so a role that holds one keeps it.
 */
export async function listAssignablePermissions(): Promise<AssignablePermission[]> {
  const stored = (await permissionRepository.findAll({ where: { key: { $in: [...ASSIGNABLE_PERMISSION_KEYS] }, isActive: true }, lean: true })) as unknown as Array<
    AssignablePermission & { _id: { toString(): string } }
  >;
  return stored
    .map((permission) => ({ _id: permission._id.toString(), key: permission.key, entity: permission.entity, action: permission.action, name: permission.name, isSystem: permission.isSystem }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
