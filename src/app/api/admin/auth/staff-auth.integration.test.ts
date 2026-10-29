import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { hashPassword, signAuthToken } from "@kira-joo/backend-toolkit-next";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { StaffUserModel } from "src/server/identity/staff-user.schema";
import { StaffRefreshTokenModel } from "src/server/identity/staff-refresh-token.schema";
import { RoleModel } from "src/server/core/authorization/role.model";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import {
  STAFF_REFRESH_COOKIE,
  STAFF_REFRESH_COOKIE_PATH,
  STAFF_SESSION_COOKIE,
} from "src/server/core/auth/staff-auth.constants";
import { hashVerificationToken } from "src/server/shop/auth/hash-verification-token";

/**
 * Route-level: every test goes through the real route handler, its DTO
 * validation, the toolkit's auth guard and the cookie writer. The cookie jar
 * stands in for `next/headers` (the toolkit's `writeTokenCookie` writes to it
 * exactly as it would to a real response); the real `Set-Cookie` headers are
 * additionally verified over HTTP against a dev server.
 */
type JarEntry = { name: string; value: string; httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string; maxAge?: number };
const jar = new Map<string, JarEntry>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (entry: JarEntry) => jar.set(entry.name, entry),
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
  }),
}));

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

type RouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
/** Static routes still receive a context; Next passes `{ params }` to every handler. */
const withoutParams = (handler: RouteHandler) => (req: NextRequest) => handler(req, { params: Promise.resolve({}) });

const login = withoutParams((await import("./login/route")).POST as RouteHandler);
const refresh = withoutParams((await import("./token/refresh/route")).POST as RouteHandler);
const logout = withoutParams((await import("./token/logout/route")).POST as RouteHandler);
const me = withoutParams((await import("./me/route")).GET as RouteHandler);
const acceptInvite = withoutParams((await import("./accept-invite/route")).POST as RouteHandler);
const inviteStaff = withoutParams((await import("../staff/route")).POST as RouteHandler);
const { PUT: updateStaff } = await import("../staff/[id]/route");
const { POST: reinvite } = await import("../staff/[id]/invite/route");

const PASSWORD = "correct-horse-battery-staple";
let ipCounter = 0;

function request(path: string, init: { method?: string; body?: unknown; cookies?: Record<string, string>; ip?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": init.ip ?? `10.0.0.${++ipCounter}` };
  if (init.cookies) headers.cookie = Object.entries(init.cookies).map(([name, value]) => `${name}=${value}`).join("; ");
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

async function createStaff(overrides: Partial<{ email: string; password: string | null; active: boolean; grantsAll: boolean }> = {}) {
  const role = await RoleModel.create({ name: `role-${new mongoose.Types.ObjectId()}`, grantsAll: overrides.grantsAll ?? false, permissions: [], isActive: true });
  return StaffUserModel.create({
    name: "Staff",
    email: overrides.email ?? `staff-${new mongoose.Types.ObjectId()}@example.com`,
    passwordHash: overrides.password === null ? undefined : await hashPassword(overrides.password ?? PASSWORD),
    active: overrides.active ?? true,
    roles: [role._id],
  });
}

async function accessCookieFor(staff: { _id: mongoose.Types.ObjectId; tokenVersion: number }) {
  return signAuthToken({ sub: staff._id.toString(), tokenVersion: staff.tokenVersion });
}

async function loginAs(email: string, password = PASSWORD) {
  jar.clear();
  return login(request("/api/admin/auth/login", { body: { email, password } }));
}

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  // Leave no staff behind: other suites (e.g. listStaff) count every StaffUser in the shared test database.
  await Promise.all([StaffUserModel.deleteMany({}), StaffRefreshTokenModel.deleteMany({}), RoleModel.deleteMany({}), RateLimitModel.deleteMany({})]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  jar.clear();
  await Promise.all([StaffUserModel.deleteMany({}), StaffRefreshTokenModel.deleteMany({}), RoleModel.deleteMany({}), RateLimitModel.deleteMany({})]);
});

describe("POST /api/admin/auth/login", () => {
  it("signs in: HttpOnly access cookie on /, refresh cookie scoped to the token prefix, no token in the body", async () => {
    const staff = await createStaff();
    const response = await loginAs(staff.email);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body._id).toBe(staff._id.toString());
    expect(JSON.stringify(body)).not.toContain(jar.get(STAFF_SESSION_COOKIE)!.value);

    const access = jar.get(STAFF_SESSION_COOKIE)!;
    const refreshCookie = jar.get(STAFF_REFRESH_COOKIE)!;
    expect(access).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 900 });
    expect(refreshCookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: STAFF_REFRESH_COOKIE_PATH, maxAge: 7 * 24 * 60 * 60 });
    expect(await StaffRefreshTokenModel.countDocuments({ subjectId: staff._id })).toBe(1);
    expect((await StaffUserModel.findById(staff._id))!.lastLoginAt).toBeInstanceOf(Date);
  });

  it("matches email case-insensitively", async () => {
    const staff = await createStaff({ email: "mixed@example.com" });
    expect((await loginAs("MIXED@Example.com")).status).toBe(200);
    expect(staff).toBeTruthy();
  });

  it.each([
    ["wrong password", async () => (await createStaff()).email, "not-the-password"],
    ["unknown account", async () => "nobody@example.com", PASSWORD],
    ["invited account that never set a password", async () => (await createStaff({ password: null })).email, PASSWORD],
    ["deactivated account", async () => (await createStaff({ active: false })).email, PASSWORD],
  ])("refuses a %s with the one identical message and sets no cookie", async (_label, makeEmail, password) => {
    const response = await loginAs(await makeEmail(), password);
    expect(response.status).toBe(401);
    expect((await response.json()).message).toBe("Invalid email or password.");
    expect(jar.size).toBe(0);
  });

  it("rate limits by account: the ninth attempt within the window is refused", async () => {
    const staff = await createStaff();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await loginAs(staff.email, "wrong-password")).status).toBe(401);
    }
    const blocked = await loginAs(staff.email);
    expect(blocked.status).toBe(429);
  });

  it("rate limits by IP across different accounts", async () => {
    const ip = "203.0.113.7";
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await login(request("/api/admin/auth/login", { body: { email: `x${attempt}@example.com`, password: "nope-nope" }, ip }));
    }
    const blocked = await login(request("/api/admin/auth/login", { body: { email: "y@example.com", password: "nope-nope" }, ip }));
    expect(blocked.status).toBe(429);
  });

  it("rejects a malformed body as a validation error", async () => {
    const response = await login(request("/api/admin/auth/login", { body: { email: "not-an-email", password: "" } }));
    expect(response.status).toBe(400);
  });
});

describe("POST /api/admin/auth/token/refresh", () => {
  async function signedIn() {
    const staff = await createStaff();
    await loginAs(staff.email);
    return { staff, refreshToken: jar.get(STAFF_REFRESH_COOKIE)!.value };
  }

  it("rotates: new cookies, and the presented token is spent", async () => {
    const { staff, refreshToken } = await signedIn();
    jar.clear();

    const response = await refresh(request("/api/admin/auth/token/refresh", { cookies: { [STAFF_REFRESH_COOKIE]: refreshToken } }));
    expect(response.status).toBe(200);
    expect((await response.json())._id).toBe(staff._id.toString());

    const rotated = jar.get(STAFF_REFRESH_COOKIE)!.value;
    expect(rotated).not.toBe(refreshToken);
    expect(jar.get(STAFF_SESSION_COOKIE)!.value).toBeTruthy();
  });

  it("reuse detection: replaying a rotated token revokes the whole family, including the newer token", async () => {
    const { refreshToken } = await signedIn();
    await refresh(request("/api/admin/auth/token/refresh", { cookies: { [STAFF_REFRESH_COOKIE]: refreshToken } }));
    const newer = jar.get(STAFF_REFRESH_COOKIE)!.value;

    const replay = await refresh(request("/api/admin/auth/token/refresh", { cookies: { [STAFF_REFRESH_COOKIE]: refreshToken } }));
    expect(replay.status).toBe(401);

    const legitimate = await refresh(request("/api/admin/auth/token/refresh", { cookies: { [STAFF_REFRESH_COOKIE]: newer } }));
    expect(legitimate.status).toBe(401);
    expect(await StaffRefreshTokenModel.countDocuments({ revokedAt: { $exists: false } })).toBe(0);
  });

  it.each([
    ["no cookie", undefined],
    ["an unknown token", "not-a-real-token"],
  ])("refuses %s with a bare 401 and clears both cookies", async (_label, token) => {
    const response = await refresh(
      request("/api/admin/auth/token/refresh", { cookies: token ? { [STAFF_REFRESH_COOKIE]: token } : undefined })
    );
    expect(response.status).toBe(401);
    expect(jar.get(STAFF_SESSION_COOKIE)).toMatchObject({ value: "", path: "/", maxAge: 0 });
    expect(jar.get(STAFF_REFRESH_COOKIE)).toMatchObject({ value: "", path: STAFF_REFRESH_COOKIE_PATH, maxAge: 0 });
  });

  it("refuses an expired token", async () => {
    const { refreshToken } = await signedIn();
    await StaffRefreshTokenModel.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const response = await refresh(request("/api/admin/auth/token/refresh", { cookies: { [STAFF_REFRESH_COOKIE]: refreshToken } }));
    expect(response.status).toBe(401);
  });

  it("refuses, and revokes, once the account is deactivated", async () => {
    const { staff, refreshToken } = await signedIn();
    await StaffUserModel.updateOne({ _id: staff._id }, { $set: { active: false } });
    const response = await refresh(request("/api/admin/auth/token/refresh", { cookies: { [STAFF_REFRESH_COOKIE]: refreshToken } }));
    expect(response.status).toBe(401);
    expect(await StaffRefreshTokenModel.countDocuments({ subjectId: staff._id, revokedAt: { $exists: false } })).toBe(0);
  });
});

describe("POST /api/admin/auth/token/logout", () => {
  it("revokes the session's family and clears both cookies with their own paths", async () => {
    const staff = await createStaff();
    await loginAs(staff.email);
    const refreshToken = jar.get(STAFF_REFRESH_COOKIE)!.value;
    jar.clear();

    const response = await logout(request("/api/admin/auth/token/logout", { cookies: { [STAFF_REFRESH_COOKIE]: refreshToken } }));
    expect(response.status).toBe(204);
    expect(jar.get(STAFF_SESSION_COOKIE)).toMatchObject({ value: "", path: "/", maxAge: 0 });
    expect(jar.get(STAFF_REFRESH_COOKIE)).toMatchObject({ value: "", path: STAFF_REFRESH_COOKIE_PATH, maxAge: 0 });

    const afterLogout = await refresh(request("/api/admin/auth/token/refresh", { cookies: { [STAFF_REFRESH_COOKIE]: refreshToken } }));
    expect(afterLogout.status).toBe(401);
  });

  it("is idempotent without a cookie", async () => {
    const response = await logout(request("/api/admin/auth/token/logout"));
    expect(response.status).toBe(204);
  });
});

describe("protected admin access", () => {
  it("GET /api/admin/auth/me answers the signed-in staff member, and 401 without a session", async () => {
    const staff = await createStaff();
    const ok = await me(request("/api/admin/auth/me", { method: "GET", cookies: { [STAFF_SESSION_COOKIE]: await accessCookieFor(staff) } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).email).toBe(staff.email);

    const anonymous = await me(request("/api/admin/auth/me", { method: "GET" }));
    expect(anonymous.status).toBe(401);
  });

  it("an access token minted before a role change or deactivation stops working (tokenVersion)", async () => {
    const admin = await createStaff({ grantsAll: true });
    const target = await createStaff();
    const staleToken = await accessCookieFor(target);

    const response = await updateStaff(
      request(`/api/admin/staff/${target._id}`, { method: "PUT", body: { active: false }, cookies: { [STAFF_SESSION_COOKIE]: await accessCookieFor(admin) } }),
      idParams(target._id.toString())
    );
    expect(response.status).toBe(200);

    const stale = await me(request("/api/admin/auth/me", { method: "GET", cookies: { [STAFF_SESSION_COOKIE]: staleToken } }));
    expect(stale.status).toBe(401);
  });

  it("refuses a staff member without StaffUser.manage (403), and allows one who has it", async () => {
    const plain = await createStaff();
    const forbidden = await inviteStaff(
      request("/api/admin/staff", { body: { name: "New", email: "new@example.com" }, cookies: { [STAFF_SESSION_COOKIE]: await accessCookieFor(plain) } })
    );
    expect(forbidden.status).toBe(403);

    const admin = await createStaff({ grantsAll: true });
    const allowed = await inviteStaff(
      request("/api/admin/staff", { body: { name: "New", email: "new@example.com" }, cookies: { [STAFF_SESSION_COOKIE]: await accessCookieFor(admin) } })
    );
    expect(allowed.status).toBe(201);
  });
});

describe("invite → activation", () => {
  async function invite(email = "invitee@example.com") {
    const admin = await createStaff({ grantsAll: true });
    const response = await inviteStaff(
      request("/api/admin/staff", { body: { name: "Invitee", email }, cookies: { [STAFF_SESSION_COOKIE]: await accessCookieFor(admin) } })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    return { admin, body, token: body.invitation.token as string };
  }

  const accept = (token: string, password = "a-strong-new-password") =>
    acceptInvite(request("/api/admin/auth/accept-invite", { body: { token, password } }));

  it("creates an unactivated account, returns the invitation once to the inviter, and never exposes its hash", async () => {
    const { body, token } = await invite();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(new Date(body.invitation.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(body.passwordResetTokenHash).toBeUndefined();
    expect(body.passwordHash).toBeUndefined();

    const stored = await StaffUserModel.findOne({ email: "invitee@example.com" }).select("+passwordResetTokenHash +passwordHash");
    expect(stored!.passwordResetTokenHash).toBe(hashVerificationToken(token));
    expect(stored!.passwordHash).toBeUndefined();
  });

  it("activates with the token: password set, token cleared, and the invitee can then sign in", async () => {
    const { token } = await invite();
    const response = await accept(token);
    expect(response.status).toBe(204);
    expect(jar.has(STAFF_SESSION_COOKIE)).toBe(false); // activation does not sign in

    const stored = await StaffUserModel.findOne({ email: "invitee@example.com" }).select("+passwordResetTokenHash +passwordHash");
    expect(stored!.passwordHash).toBeTruthy();
    expect(stored!.passwordResetTokenHash).toBeUndefined();

    expect((await loginAs("invitee@example.com", "a-strong-new-password")).status).toBe(200);
  });

  it.each([
    ["an invalid token", async () => "definitely-not-a-token"],
    [
      "an expired invitation",
      async () => {
        const { token } = await invite();
        await StaffUserModel.updateOne({ email: "invitee@example.com" }, { $set: { passwordResetExpiresAt: new Date(Date.now() - 1000) } });
        return token;
      },
    ],
    [
      "an already-used invitation",
      async () => {
        const { token } = await invite();
        expect((await accept(token)).status).toBe(204);
        return token;
      },
    ],
  ])("refuses %s with one identical message", async (_label, tokenFor) => {
    const response = await accept(await tokenFor());
    expect(response.status).toBe(401);
    expect((await response.json()).message).toBe("This invitation link is invalid or has expired.");
  });

  it("two concurrent acceptances of one token: exactly one succeeds", async () => {
    const { token } = await invite();
    const results = await Promise.all([accept(token, "first-password-123"), accept(token, "second-password-456")]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 401]);
  });

  it("enforces the password policy", async () => {
    const { token } = await invite();
    expect((await accept(token, "short")).status).toBe(400);
  });

  it("re-invite replaces the token (the old one stops working) and is refused once activated", async () => {
    const { admin, body, token: first } = await invite();
    const adminCookie = { [STAFF_SESSION_COOKIE]: await accessCookieFor(admin) };

    const reissued = await reinvite(request(`/api/admin/staff/${body._id}/invite`, { cookies: adminCookie }), idParams(body._id));
    expect(reissued.status).toBe(200);
    const second = (await reissued.json()).token as string;
    expect(second).not.toBe(first);

    expect((await accept(first)).status).toBe(401);
    expect((await accept(second)).status).toBe(204);

    const afterActivation = await reinvite(request(`/api/admin/staff/${body._id}/invite`, { cookies: adminCookie }), idParams(body._id));
    expect(afterActivation.status).toBe(409);
  });

  it("rate limits activation attempts by IP", async () => {
    const ip = "198.51.100.9";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await acceptInvite(request("/api/admin/auth/accept-invite", { body: { token: `guess-${attempt}`, password: "a-strong-new-password" }, ip }));
    }
    const blocked = await acceptInvite(request("/api/admin/auth/accept-invite", { body: { token: "guess-x", password: "a-strong-new-password" }, ip }));
    expect(blocked.status).toBe(429);
  });
});
