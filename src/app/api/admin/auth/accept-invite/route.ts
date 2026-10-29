import { createPostRoute } from "../../../../../server/core/route-factories";
import { AcceptStaffInviteDto } from "../../../../../server/admin/dto/accept-staff-invite.dto";
import { acceptStaffInvite } from "../../../../../server/admin/auth/staff-auth";
import { RATE_LIMITS, enforceRateLimit, resolveClientIp } from "../../../../../server/core/rate-limit/enforce-rate-limit";

export const dynamic = "force-dynamic";

/**
 * Public by necessity — the invitee has no session yet; the invitation token
 * is the credential. Outside the refresh cookie's prefix on purpose: it must
 * never receive one. Rate limited by IP. Answers 204; the invitee then signs
 * in with the password they chose.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 204,
  body: AcceptStaffInviteDto,
  handler: async ({ body, request }) => {
    await enforceRateLimit({ key: `staff-invite-accept:ip:${resolveClientIp(request)}`, ...RATE_LIMITS.PASSWORD_RESET_REQUEST });
    await acceptStaffInvite(body.token, body.password, new Date());
    return undefined;
  },
});
