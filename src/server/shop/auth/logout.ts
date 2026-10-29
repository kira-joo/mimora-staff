import { revokeToken } from "@kira-joo/backend-toolkit-mongoose";
import { CustomerRefreshTokenModel } from "../../identity/customer-refresh-token.schema";
import { clearCustomerSessionCookies } from "../../core/auth/customer-session-cookies";

/**
 * Revokes the presented refresh token's family (this device's chain only —
 * `revokeToken`'s own doc comment: "logging out on a phone should not sign
 * someone out of their laptop") and clears all three cookies regardless of
 * whether a token was present at all.
 *
 * **Must work when the token has already expired or been revoked** — MDS
 * §19's rule for staff logout applies identically here. `revokeToken`
 * itself is naturally idempotent (`revokeFamily`'s own `revokedAt:
 * {$exists:false}` filter makes revoking an already-revoked family a
 * no-op), and clearing already-cleared cookies is harmless — this route
 * does NOT go through `claimIdempotentMutation` for exactly that reason:
 * there is no destructive double-effect a retry could cause.
 */
export async function logoutCustomer(presentedRefreshToken: string | null): Promise<void> {
  if (presentedRefreshToken) {
    await revokeToken(CustomerRefreshTokenModel, presentedRefreshToken);
  }
  await clearCustomerSessionCookies();
}
