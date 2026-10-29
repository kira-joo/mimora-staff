import { eraseTokenCookie, writeTokenCookie } from "@kira-joo/backend-toolkit-next";
import {
  STAFF_ACCESS_TOKEN_TTL_SECONDS,
  STAFF_REFRESH_COOKIE,
  STAFF_REFRESH_COOKIE_PATH,
  STAFF_REFRESH_TOKEN_TTL_MS,
  STAFF_SESSION_COOKIE,
} from "./staff-auth.constants";

/** Both staff cookies are HttpOnly, `SameSite=Lax`, and `Secure` outside development (the toolkit's defaults). */
export async function writeStaffSessionCookies(values: { accessToken: string; refreshToken: string }): Promise<void> {
  await writeTokenCookie(values.accessToken, { name: STAFF_SESSION_COOKIE, path: "/", maxAge: STAFF_ACCESS_TOKEN_TTL_SECONDS });
  await writeTokenCookie(values.refreshToken, {
    name: STAFF_REFRESH_COOKIE,
    path: STAFF_REFRESH_COOKIE_PATH,
    maxAge: STAFF_REFRESH_TOKEN_TTL_MS / 1000,
  });
}

/** Re-sends each cookie's own path — a clear with the wrong path leaves the browser holding the cookie. */
export async function clearStaffSessionCookies(): Promise<void> {
  await eraseTokenCookie({ name: STAFF_SESSION_COOKIE, path: "/" });
  await eraseTokenCookie({ name: STAFF_REFRESH_COOKIE, path: STAFF_REFRESH_COOKIE_PATH });
}
