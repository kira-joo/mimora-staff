import { createPutRoute } from "src/server/core/route-factories";
import { RATE_LIMITS, enforceRateLimit } from "src/server/core/rate-limit/enforce-rate-limit";
import { ChangePasswordDto } from "src/server/shop/dto/change-password.dto";
import { requireCustomer } from "src/server/shop/shop-actor";
import { changePassword } from "src/server/shop/profile/change-password";

/**
 * PUT /api/shop/profile/password — changes the authenticated customer's password.
 *
 * Verifies old password, updates to new password, and increments tokenVersion
 * to revoke all existing sessions. Customer must re-authenticate after this.
 *
 * Strictly rate limited (5/hour) to prevent brute-force attacks.
 */
export const PUT = createPutRoute({
  auth: false,
  body: ChangePasswordDto,
  handler: async ({ request, body }) => {
    const customer = await requireCustomer(request);

    await enforceRateLimit({ key: `PASSWORD_CHANGE:${customer._id}`, ...RATE_LIMITS.PASSWORD_CHANGE });

    await changePassword(customer._id, {
      oldPassword: body.oldPassword,
      newPassword: body.newPassword,
    });

    return { message: "Password changed successfully. Please log in again." };
  },
});

export const dynamic = "force-dynamic";
