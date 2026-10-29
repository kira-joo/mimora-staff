import { readTokenCookie } from "@kira-joo/backend-toolkit-next";
import { createPostRoute } from "../../../../../../server/core/route-factories";
import { logoutStaff } from "../../../../../../server/admin/auth/staff-auth";
import { STAFF_REFRESH_COOKIE } from "../../../../../../server/core/auth/staff-auth.constants";
import { clearStaffSessionCookies } from "../../../../../../server/core/auth/staff-session-cookies";

export const dynamic = "force-dynamic";

/**
 * Under the refresh cookie's path, so the browser actually sends the token to
 * revoke — a logout route outside that prefix would receive no cookie, revoke
 * nothing, and still answer success. Idempotent; always clears both cookies.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 204,
  handler: async ({ request }) => {
    try {
      await logoutStaff(readTokenCookie(request, STAFF_REFRESH_COOKIE));
    } finally {
      await clearStaffSessionCookies();
    }
    return undefined;
  },
});
