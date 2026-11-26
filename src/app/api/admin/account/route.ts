import { createGetRoute, createPutRoute } from "../../../../server/core/route-factories";
import { UpdateOwnAccountDto } from "../../../../server/admin/dto/account.dto";
import { getOwnAccount, updateOwnAccount } from "../../../../server/admin/account/own-account";
import { recordActivity } from "../../../../server/core/activity/record-activity";

/**
 * The caller's OWN account — session required, no permission (every staff member may see and edit themselves). The
 * id always comes from the authenticated session, never from the request, so nobody can reach another account here.
 */
export const GET = createGetRoute({
  auth: true,
  handler: async ({ user }) => getOwnAccount(user._id),
});

export const PUT = createPutRoute({
  auth: true,
  body: UpdateOwnAccountDto,
  handler: async ({ user, body, request }) => {
    const account = await updateOwnAccount(user._id, body);
    // Self-service routes carry no permission, so the factory does not audit them; record it here.
    await recordActivity({ permissionKey: "StaffUser.updateOwnAccount", user, params: { id: user._id }, body, result: account, request });
    return account;
  },
});
