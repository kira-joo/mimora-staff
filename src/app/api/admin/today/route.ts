import { createGetRoute } from "../../../../server/core/route-factories";
import { getToday } from "../../../../server/admin/today/get-today";
import { TODAY_PERMISSIONS } from "../../../../server/engines/today/today-sections";

/**
 * Any ONE of the panels' permissions opens the route (`permissionMode` defaults to "any"); `getToday` then returns
 * only the sections the caller actually holds the permission for. Authorization is per section, server-side.
 */
export const GET = createGetRoute({
  auth: { permissions: [...TODAY_PERMISSIONS] },
  handler: async ({ user }) => getToday(user, new Date()),
});
