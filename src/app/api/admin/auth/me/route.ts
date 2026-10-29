import { createGetRoute } from "../../../../../server/core/route-factories";

/** The signed-in staff member and their resolved roles/permissions — any authenticated staff member may read their own. */
export const GET = createGetRoute({
  auth: true,
  handler: async ({ user }) => user,
});
