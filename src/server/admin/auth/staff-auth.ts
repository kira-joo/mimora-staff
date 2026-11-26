import { randomBytes } from "node:crypto";
import { UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import { issueRefreshToken, revokeAllForSubject, revokeFamily, revokeToken, rotateRefreshToken } from "@kira-joo/backend-toolkit-mongoose";
import { comparePassword, hashPassword, signAuthToken } from "@kira-joo/backend-toolkit-next";
import type mongoose from "mongoose";
import { staffUserRepository } from "../../core/repositories";
import { StaffUserModel } from "../../identity/staff-user.schema";
import { StaffRefreshTokenModel } from "../../identity/staff-refresh-token.schema";
import { STAFF_ACCESS_TOKEN_TTL_SECONDS, STAFF_REFRESH_TOKEN_TTL_MS } from "../../core/auth/staff-auth.constants";
import { writeStaffSessionCookies } from "../../core/auth/staff-session-cookies";
import { hashVerificationToken } from "../../shop/auth/hash-verification-token";

/**
 * Staff authentication: login, refresh, logout, invitation acceptance.
 *
 * The architecture is `restaurant-platform-staff`'s (the workspace's reference
 * for staff auth), on this repository's own audience boundary: a short-lived
 * access JWT in `store_staff_session` (path `/`), a rotating refresh token in
 * `store_staff_refresh` scoped to `/api/admin/auth/token`, refresh tokens in
 * their own `staff_refresh_tokens` collection, and the staff JWT secret from
 * the one toolkit configuration. Neither token ever appears in a response
 * body; the frontend never reads, stores or attaches one.
 */

const INVALID_CREDENTIALS = "Invalid email or password.";
const INVALID_INVITATION = "This invitation link is invalid or has expired.";

/**
 * Issues a fresh session: an access token signed with the staff secret and a
 * new refresh-token family, both written as HttpOnly cookies.
 */
export async function issueStaffSession(subject: { _id: mongoose.Types.ObjectId; tokenVersion: number }): Promise<void> {
  const [accessToken, refresh] = await Promise.all([
    signAuthToken({ sub: subject._id.toString(), tokenVersion: subject.tokenVersion }, { expiresIn: STAFF_ACCESS_TOKEN_TTL_SECONDS }),
    issueRefreshToken({ model: StaffRefreshTokenModel, subjectId: subject._id, ttlMs: STAFF_REFRESH_TOKEN_TTL_MS }),
  ]);
  await writeStaffSessionCookies({ accessToken, refreshToken: refresh.token });
}

/**
 * Verifies credentials and starts a session. Returns the staff id.
 *
 * **One message for every failure** — unknown email, wrong password, an
 * invited account that never set a password, a deactivated account — and the
 * password comparison runs in every case, against a real decoy hash when there
 * is no account, so response time does not reveal which one it was.
 *
 * A direct Model read, deliberately: `passwordHash` is `select: false`, and the
 * repository's projection never returns a `select: false` field by design.
 */
export async function loginStaff(email: string, password: string, now: Date): Promise<mongoose.Types.ObjectId> {
  const record = await StaffUserModel.findOne({ email: email.toLowerCase().trim() })
    .select("+passwordHash")
    .lean<{ _id: mongoose.Types.ObjectId; passwordHash?: string; active: boolean; tokenVersion: number }>();

  const matches = await comparePassword(password, record?.passwordHash ?? (await decoyHash()));
  if (!record || !record.passwordHash || !matches || !record.active) {
    throw new UnauthorizedError(INVALID_CREDENTIALS);
  }

  // The session is issued only if the password just verified is still the account's password — checked again AFTER
  // the refresh family exists, so a password change racing this login either sees the family (and revokes it) or is
  // seen here (and the family is revoked). Before or after, a login with the old password cannot outlive the change.
  const [accessToken, refresh] = await Promise.all([
    signAuthToken({ sub: record._id.toString(), tokenVersion: record.tokenVersion }, { expiresIn: STAFF_ACCESS_TOKEN_TTL_SECONDS }),
    issueRefreshToken({ model: StaffRefreshTokenModel, subjectId: record._id, ttlMs: STAFF_REFRESH_TOKEN_TTL_MS }),
  ]);
  const stamped = await staffUserRepository.updateAtomic(
    { _id: record._id, active: true, passwordHash: record.passwordHash, tokenVersion: record.tokenVersion },
    { $set: { lastLoginAt: now } },
    { skipThrowError: true }
  );
  if (!stamped) {
    await revokeFamily(StaffRefreshTokenModel, refresh.familyId);
    throw new UnauthorizedError(INVALID_CREDENTIALS);
  }
  await writeStaffSessionCookies({ accessToken, refreshToken: refresh.token });
  return record._id;
}

/**
 * Rotates the presented refresh token and re-issues both cookies. Returns the
 * staff id.
 *
 * Every failure is the same bare `UnauthorizedError`: an unknown, expired,
 * revoked or already-rotated token (the last revokes its whole family inside
 * `rotateRefreshToken`), and an account that no longer exists or was
 * deactivated — whose remaining families are revoked here, since the token
 * outlived the account's right to it.
 */
export async function refreshStaffSession(presentedToken: string | null): Promise<mongoose.Types.ObjectId> {
  if (!presentedToken) throw new UnauthorizedError();

  const { subjectId, issued } = await rotateRefreshToken(StaffRefreshTokenModel, presentedToken, STAFF_REFRESH_TOKEN_TTL_MS);

  const staff = await staffUserRepository.findOne({ where: { _id: subjectId }, skipThrowError: true });
  if (!staff || !staff.active) {
    await revokeAllForSubject(StaffRefreshTokenModel, subjectId);
    throw new UnauthorizedError();
  }

  // A family started before the last password change is dead, even if its successor slipped past that change's
  // revocation sweep (the rotation above inserts it after claiming the old token). Read AFTER the rotation, so either
  // the sweep saw the successor or this read sees the change.
  if (staff.sessionsValidFrom && (await familyStartedAt(issued.familyId)) < staff.sessionsValidFrom.getTime()) {
    await revokeFamily(StaffRefreshTokenModel, issued.familyId);
    throw new UnauthorizedError();
  }

  const accessToken = await signAuthToken(
    { sub: staff._id.toString(), tokenVersion: staff.tokenVersion },
    { expiresIn: STAFF_ACCESS_TOKEN_TTL_SECONDS }
  );
  await writeStaffSessionCookies({ accessToken, refreshToken: issued.token });
  return staff._id;
}

/**
 * Revokes the presented token's family. Idempotent and silent: logging out
 * with an unknown or already-revoked token is still a logout.
 */
export async function logoutStaff(presentedToken: string | null): Promise<void> {
  if (!presentedToken) return;
  await revokeToken(StaffRefreshTokenModel, presentedToken);
}

/**
 * Completes an invitation: sets the password and activates the account.
 *
 * The claim is **one atomic write**: it matches only an account that still
 * has no password, holds exactly this token's hash, and whose invitation has
 * not expired — and in the same update sets the password and clears the
 * token. So an invalid, expired, superseded (re-invited) or already-used
 * token matches nothing, two concurrent acceptances cannot both succeed, and
 * all of them fail with one message.
 *
 * Does not sign the user in — they log in with the password they just chose,
 * as `restaurant-platform-staff`'s reset flow does. `tokenVersion` is bumped
 * and any refresh family revoked so nothing issued before activation survives.
 */
export async function acceptStaffInvite(token: string, password: string, now: Date): Promise<void> {
  const passwordHash = await hashPassword(password);

  const activated = await staffUserRepository.updateAtomic(
    {
      passwordResetTokenHash: hashVerificationToken(token),
      passwordResetExpiresAt: { $gt: now },
      passwordHash: { $exists: false },
    },
    {
      $set: { passwordHash },
      $unset: { passwordResetTokenHash: "", passwordResetExpiresAt: "" },
      $inc: { tokenVersion: 1 },
    },
    { skipThrowError: true }
  );
  if (!activated) throw new UnauthorizedError(INVALID_INVITATION);

  await revokeAllForSubject(StaffRefreshTokenModel, activated._id);
}

/**
 * When a refresh-token family began: its oldest surviving token's issue time (`expiresAt` minus the fixed TTL —
 * millisecond-exact, unlike an ObjectId's one-second timestamp). Rotation never shortens a token's life, so the oldest
 * row is the one issued at login (or the earliest still alive, which is no earlier than any change it outlived).
 */
async function familyStartedAt(familyId: string): Promise<number> {
  const first = await StaffRefreshTokenModel.findOne({ familyId }, { expiresAt: 1 }).sort({ expiresAt: 1 }).lean<{ expiresAt: Date }>();
  return first ? first.expiresAt.getTime() - STAFF_REFRESH_TOKEN_TTL_MS : 0;
}

let decoy: Promise<string> | undefined;

/**
 * A real scrypt hash of a random secret, computed once per process. A
 * hardcoded literal would not do: a malformed hash makes `comparePassword`
 * return immediately, which is exactly the timing difference this exists to
 * remove.
 */
function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(32).toString("base64url"));
  return decoy;
}
