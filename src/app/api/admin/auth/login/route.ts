import { createPostRoute } from "../../../../../server/core/route-factories";
import { StaffLoginDto } from "../../../../../server/admin/dto/staff-login.dto";
import { loginStaff } from "../../../../../server/admin/auth/staff-auth";
import { resolveStaffUser } from "../../../../../server/core/auth/resolve-staff-user";
import { RATE_LIMITS, clearRateLimit, enforceRateLimit, resolveClientIp } from "../../../../../server/core/rate-limit/enforce-rate-limit";

export const dynamic = "force-dynamic";

/**
 * Public by necessity — this is how a staff member obtains a session. Rate
 * limited by IP and by account, so neither a sprayed password nor a targeted
 * account can be guessed at volume; a success clears only the account counter.
 * Tokens travel only as HttpOnly cookies; the body carries the staff profile.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 200,
  body: StaffLoginDto,
  handler: async ({ body, request }) => {
    const accountKey = `staff-login:account:${body.email.toLowerCase().trim()}`;
    await enforceRateLimit({ key: `staff-login:ip:${resolveClientIp(request)}`, ...RATE_LIMITS.LOGIN });
    await enforceRateLimit({ key: accountKey, ...RATE_LIMITS.LOGIN });

    const staffId = await loginStaff(body.email, body.password, new Date());
    await clearRateLimit(accountKey);
    return resolveStaffUser(staffId.toString());
  },
});
