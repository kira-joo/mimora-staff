import { syncPermissions } from "@kira-joo/backend-toolkit-mongoose";
import { createPostRoute } from "../../../../../server/core/route-factories";
import { PermissionModel } from "../../../../../server/core/authorization/role.model";
import { ALL_PERMISSION_DEFINITIONS, CustomPermission } from "../../../../../common/authorization/authorization-registry";

/**
 * Re-runs the same insert-only sync `instrumentation.ts` runs at boot —
 * exposed as an on-demand admin action for the case a deploy adds a new
 * `EntityName`/`CustomPermission` entry and an operator wants it available
 * without restarting every instance. MDS §18: "a queue of pending/
 * published/rejected... `POST /permissions/sync` is explicitly
 * superadmin-only" — gated on `Permission.manage`, never on a generic
 * CRUD permission, since granting it is equivalent to defining what every
 * other permission in the system even means.
 */
export const POST = createPostRoute({
  auth: { permissions: [CustomPermission.PERMISSION_MANAGE] },
  successStatus: 200,
  handler: async () => {
    const result = await syncPermissions({ model: PermissionModel, definitions: ALL_PERMISSION_DEFINITIONS });
    return result;
  },
});
