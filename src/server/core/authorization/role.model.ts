import { createPermissionModel, createRoleModel } from "@kira-joo/backend-toolkit-mongoose";

/**
 * The domain-neutral Role/Permission collections, promoted from
 * `@kira-joo/backend-toolkit-mongoose` — the same factories
 * `restaurant-platform-staff` instantiates. Phase 2 (`09c8588`) committed
 * `StaffUser.role` as a flat string instead of a relation to these, which
 * cannot express "exactly this permission but not others" — the shape
 * Phase 4's own permission-coverage requirement needs. Corrected here as
 * part of Phase 4's auth foundation (see `staff-user.schema.ts`).
 */
export const PermissionModel = createPermissionModel();
export const RoleModel = createRoleModel();
