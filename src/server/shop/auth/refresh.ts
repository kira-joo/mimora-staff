import { UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import { rotateRefreshToken } from "@kira-joo/backend-toolkit-mongoose";
import { signAuthToken } from "@kira-joo/backend-toolkit-next";
import { customerRepository } from "../../core/repositories";
import { CustomerRefreshTokenModel } from "../../identity/customer-refresh-token.schema";
import { customerJwtConfig } from "../../core/auth/customer-jwt-config";
import { writeCustomerSessionCookies } from "../../core/auth/customer-session-cookies";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_MS } from "./customer-auth.constants";

/**
 * Rotates the presented refresh token and writes a fresh access + refresh
 * cookie pair.
 *
 * **Reuse detection lives entirely inside `rotateRefreshToken`** (this
 * repo's own toolkit dependency, `backend-toolkit-mongoose`) — presenting
 * an already-rotated token revokes the whole family and throws
 * `UnauthorizedError`, the identical error every other failure path here
 * throws too (unknown, expired, revoked, reused — MDS §19: distinguishing
 * them tells an attacker which guess was once real).
 *
 * This function does not itself decide whether the presented token exists
 * — it delegates entirely to `rotateRefreshToken`, which is exactly why
 * this route is one of the ones this batch scopes into
 * `claimIdempotentMutation` (see `route.ts`): a client retry after a
 * dropped response, presenting the SAME already-rotated token again, would
 * otherwise look identical to a stolen-token reuse attempt and revoke the
 * customer's whole session — the idempotent replay is what prevents that.
 */
export async function refreshCustomerSession(presentedRefreshToken: string): Promise<void> {
  const { subjectId, issued } = await rotateRefreshToken(CustomerRefreshTokenModel, presentedRefreshToken, REFRESH_TOKEN_TTL_MS);

  const customer = await customerRepository.findOne({ where: { _id: subjectId }, skipThrowError: true });
  if (!customer) throw new UnauthorizedError();

  const accessToken = await signAuthToken(
    { sub: customer._id.toString(), tokenVersion: customer.tokenVersion },
    { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    customerJwtConfig()
  );

  await writeCustomerSessionCookies({
    accessToken,
    accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: issued.token,
    refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_MS / 1000,
  });
}
