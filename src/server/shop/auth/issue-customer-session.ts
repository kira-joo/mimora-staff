import { issueRefreshToken } from "@kira-joo/backend-toolkit-mongoose";
import { signAuthToken } from "@kira-joo/backend-toolkit-next";
import type mongoose from "mongoose";
import { CustomerRefreshTokenModel } from "../../identity/customer-refresh-token.schema";
import { customerJwtConfig } from "../../core/auth/customer-jwt-config";
import { writeCustomerSessionCookies } from "../../core/auth/customer-session-cookies";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_MS } from "./customer-auth.constants";

export interface CustomerSessionSubject {
  _id: mongoose.Types.ObjectId;
  tokenVersion: number;
}

/**
 * Mints a fresh access token + a fresh refresh token family, writes all
 * three session cookies, and returns nothing — the whole point is that a
 * token never appears in a JSON response body (see `writeTokenCookie`'s
 * own example). Shared by `login`, `signup`, and (for the access-token
 * half only) `refresh`.
 *
 * Starts a NEW refresh-token family (no `familyId` passed to
 * `issueRefreshToken`) — correct for login/signup, which begin a session;
 * `refresh` calls `rotateRefreshToken` directly instead, which continues
 * the existing family rather than starting a new one.
 */
export async function issueCustomerSession(subject: CustomerSessionSubject): Promise<void> {
  const [accessToken, refresh] = await Promise.all([
    signAuthToken({ sub: subject._id.toString(), tokenVersion: subject.tokenVersion }, { expiresIn: ACCESS_TOKEN_TTL_SECONDS }, customerJwtConfig()),
    issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId: subject._id, ttlMs: REFRESH_TOKEN_TTL_MS }),
  ]);

  await writeCustomerSessionCookies({
    accessToken,
    accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: refresh.token,
    refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_MS / 1000,
  });
}
