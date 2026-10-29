import { readTokenCookie } from "@kira-joo/backend-toolkit-next";
import { createPostRoute } from "../../../../../../server/core/route-factories";
import { refreshStaffSession } from "../../../../../../server/admin/auth/staff-auth";
import { resolveStaffUser } from "../../../../../../server/core/auth/resolve-staff-user";
import { STAFF_REFRESH_COOKIE } from "../../../../../../server/core/auth/staff-auth.constants";
import { clearStaffSessionCookies } from "../../../../../../server/core/auth/staff-session-cookies";

export const dynamic = "force-dynamic";

/**
 * Lives under the refresh cookie's path prefix, which is the only reason the
 * browser sends that cookie here. Reads the token from the cookie, never the
 * body. On any failure both cookies are cleared, so a dead session does not
 * keep presenting itself.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 200,
  handler: async ({ request }) => {
    try {
      const staffId = await refreshStaffSession(readTokenCookie(request, STAFF_REFRESH_COOKIE));
      return await resolveStaffUser(staffId.toString());
    } catch (error) {
      await clearStaffSessionCookies();
      throw error;
    }
  },
});
