import { createPutRoute } from "../../../../../server/core/route-factories";
import { ChangeOwnPasswordDto } from "../../../../../server/admin/dto/account.dto";
import { changeOwnPassword } from "../../../../../server/admin/account/own-account";
import { recordActivity } from "../../../../../server/core/activity/record-activity";
import { RATE_LIMITS, clearRateLimit, enforceRateLimit } from "../../../../../server/core/rate-limit/enforce-rate-limit";

/**
 * Changes the caller's own password: the current one must be proven, attempts are rate limited per account (a stolen
 * session must not be a password-guessing oracle), every other session is signed out and this one is re-issued.
 * Neither password is ever logged: the audit entry's body is redacted by key.
 */
export const PUT = createPutRoute({
  auth: true,
  successStatus: 204,
  body: ChangeOwnPasswordDto,
  handler: async ({ user, body, request }) => {
    const key = `staff-password-change:account:${user._id}`;
    await enforceRateLimit({ key, ...RATE_LIMITS.LOGIN });
    await changeOwnPassword(user._id, body);
    await clearRateLimit(key);
    await recordActivity({ permissionKey: "StaffUser.changeOwnPassword", user, params: { id: user._id }, body, request });
    return undefined;
  },
});
