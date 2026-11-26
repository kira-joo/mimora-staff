import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { comparePassword, hashPassword, signAuthToken } from "@kira-joo/backend-toolkit-next";
import { issueRefreshToken } from "@kira-joo/backend-toolkit-mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { StaffUserModel } from "src/server/identity/staff-user.schema";
import { StaffRefreshTokenModel } from "src/server/identity/staff-refresh-token.schema";
import { PermissionModel, RoleModel } from "src/server/core/authorization/role.model";
import { DefaultRoleSeedModel } from "src/server/core/authorization/default-role-seed.schema";
import { ActivityLogModel } from "src/server/core/activity-log.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import { reconcilePermissions } from "src/server/core/authorization/reconcile-permissions";
import { seedDefaultRoles } from "src/server/admin/staff/seed-default-roles";
import { createStaffDirect } from "src/server/admin/staff/create-staff-direct";
import { resolveStaffUser } from "src/server/core/auth/resolve-staff-user";
import { ALL_PERMISSION_DEFINITIONS, AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { STAFF_REFRESH_COOKIE, STAFF_SESSION_COOKIE } from "src/server/core/auth/staff-auth.constants";

/**
 * Dynamic roles, direct account creation and the own-account surface — through the real route handlers, DTO
 * validation, the toolkit's auth guard and the cookie writer (the jar stands in for `next/headers`).
 *
 * The cases that matter are the NEGATIVE ones: a holder of a narrow permission must not be able to climb.
 */
type JarEntry = { name: string; value: string; path?: string; maxAge?: number };
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
const noParams = { params: Promise.resolve({}) };
const idParams = (id: unknown) => ({ params: Promise.resolve({ id: String(id) }) });

const rolesRoute = await import("./route");
const roleRoute = await import("./[id]/route");
const permissionsRoute = await import("../permissions/route");
const staffRoute = await import("../staff/route");
const staffIdRoute = await import("../staff/[id]/route");
const reinviteRoute = await import("../staff/[id]/invite/route");
const directRoute = await import("../staff/direct/route");
const accountRoute = await import("../account/route");
const passwordRoute = await import("../account/password/route");
const loginRoute = await import("../auth/login/route");
const refreshRoute = await import("../auth/token/refresh/route");
const ordersRoute = await import("../orders/route");

const PASSWORD = "correct-horse-battery-staple";
let ip = 0;

type Actor = { _id: mongoose.Types.ObjectId; tokenVersion: number };

async function call(handler: unknown, path: string, init: { method: string; body?: unknown; as?: Actor; cookies?: Record<string, string> }, context = noParams) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ip % 250}` };
  const cookies = { ...(init.cookies ?? {}) };
  if (init.as) cookies[STAFF_SESSION_COOKIE] = await signAuthToken({ sub: init.as._id.toString(), tokenVersion: init.as.tokenVersion });
  if (Object.keys(cookies).length) headers.cookie = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
  const response = await (handler as RouteHandler)(
    new NextRequest(`http://localhost${path}`, { method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }),
    context
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function roleWith(name: string, keys: string[], grantsAll = false) {
  const permissions = await PermissionModel.find({ key: { $in: keys } }, { _id: 1 }).lean();
  expect(permissions).toHaveLength(keys.length);
  return RoleModel.create({ name, grantsAll, isActive: true, permissions: permissions.map((p) => p._id) });
}

async function staffWith(roles: mongoose.Types.ObjectId[], overrides: Partial<{ password: string | null; mustChangePassword: boolean; email: string }> = {}) {
  return StaffUserModel.create({
    name: "Staff",
    email: overrides.email ?? `staff-${new mongoose.Types.ObjectId()}@example.com`,
    passwordHash: overrides.password === null ? undefined : await hashPassword(overrides.password ?? PASSWORD),
    roles,
    active: true,
    ...(overrides.mustChangePassword ? { mustChangePassword: true } : {}),
  });
}

const wipe = () =>
  Promise.all([
    StaffUserModel.deleteMany({}),
    RoleModel.deleteMany({}),
    DefaultRoleSeedModel.deleteMany({}),
    StaffRefreshTokenModel.deleteMany({}),
    ActivityLogModel.deleteMany({}),
    RateLimitModel.deleteMany({}),
  ]);

let ownerRole: mongoose.Types.ObjectId;
let owner: Actor;

beforeAll(async () => {
  await connectToDatabase();
  await reconcilePermissions({ model: PermissionModel, definitions: ALL_PERMISSION_DEFINITIONS });
});

beforeEach(async () => {
  jar.clear();
  await wipe();
  await seedDefaultRoles();
  ownerRole = (await RoleModel.findOne({ name: "Owner" }).lean())!._id;
  owner = await staffWith([ownerRole]);
});

afterAll(async () => {
  await wipe();
  await PermissionModel.deleteMany({});
  await mongoose.disconnect();
});

describe("roles CRUD (as an Owner)", () => {
  it("creates a role from permission keys, lists it with member counts, edits it, and deletes it once unused", async () => {
    const created = await call(rolesRoute.POST, "/api/admin/roles", {
      method: "POST",
      as: owner,
      body: { name: "Catalog editor", permissionKeys: [AppPermission.PRODUCT.READ, AppPermission.PRODUCT.UPDATE] },
    });
    expect(created.status).toBe(201);
    expect(created.body.permissions.map((p: { key: string }) => p.key).sort()).toEqual([AppPermission.PRODUCT.READ, AppPermission.PRODUCT.UPDATE].sort());
    const roleId = created.body._id as string;

    await staffWith([new mongoose.Types.ObjectId(roleId)]);
    const list = await call(rolesRoute.GET, "/api/admin/roles", { method: "GET", as: owner });
    expect(list.status).toBe(200);
    expect(list.body.data[0].name).toBe("Owner"); // Owner first
    expect(list.body.data.find((r: { _id: string }) => r._id === roleId)).toMatchObject({ memberCount: 1, activeMemberCount: 1, isOwnerRole: false });
    expect(list.body.data.find((r: { name: string }) => r.name === "Owner")).toMatchObject({ memberCount: 1, isOwnerRole: true });

    const edited = await call(roleRoute.PUT, `/api/admin/roles/${roleId}`, { method: "PUT", as: owner, body: { name: "Catalog lead", permissionKeys: [AppPermission.PRODUCT.READ] } }, idParams(roleId));
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ name: "Catalog lead", permissions: [expect.objectContaining({ key: AppPermission.PRODUCT.READ })] });

    const blocked = await call(roleRoute.DELETE, `/api/admin/roles/${roleId}`, { method: "DELETE", as: owner }, idParams(roleId));
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/1 team member has this role/);

    await StaffUserModel.updateMany({}, { $pull: { roles: new mongoose.Types.ObjectId(roleId) } });
    const deleted = await call(roleRoute.DELETE, `/api/admin/roles/${roleId}`, { method: "DELETE", as: owner }, idParams(roleId));
    expect(deleted.status).toBe(200);
    expect(await RoleModel.countDocuments({ _id: roleId })).toBe(0);

    const audit = await ActivityLogModel.find({ entityType: "Role" }).lean();
    expect(audit.map((entry) => entry.action).sort()).toEqual(["create", "delete", "update"]);
  });

  it("edits the existing default roles — no hidden restriction — and the edit survives the next boot's seed", async () => {
    const manager = (await RoleModel.findOne({ name: "Manager" }).lean())!;
    const edited = await call(roleRoute.PUT, `/api/admin/roles/${manager._id}`, { method: "PUT", as: owner, body: { permissionKeys: [AppPermission.ORDER.READ] } }, idParams(manager._id));
    expect(edited.status).toBe(200);

    await seedDefaultRoles(); // what the next deploy's boot runs
    const after = await RoleModel.findById(manager._id).populate("permissions").lean();
    expect((after!.permissions as unknown as Array<{ key: string }>).map((p) => p.key)).toEqual([AppPermission.ORDER.READ]);
  });

  it("validates: unknown or unenforced permission keys 400, duplicate names (any case) 409, empty name 400", async () => {
    const unknown = await call(rolesRoute.POST, "/api/admin/roles", { method: "POST", as: owner, body: { name: "X", permissionKeys: ["Product.fly"] } });
    expect(unknown.status).toBe(400);
    const unenforced = await call(rolesRoute.POST, "/api/admin/roles", { method: "POST", as: owner, body: { name: "X", permissionKeys: ["Wishlist.read"] } });
    expect(unenforced.status).toBe(400);
    const duplicate = await call(rolesRoute.POST, "/api/admin/roles", { method: "POST", as: owner, body: { name: "  manager ", permissionKeys: [] } });
    expect(duplicate.status).toBe(409);
    const empty = await call(rolesRoute.POST, "/api/admin/roles", { method: "POST", as: owner, body: { name: " ", permissionKeys: [] } });
    expect(empty.status).toBe(400);
  });

  it("protects the Owner role: never renamed, deleted, deactivated or stripped of full access", async () => {
    const id = ownerRole.toString();
    expect((await call(roleRoute.PUT, `/api/admin/roles/${id}`, { method: "PUT", as: owner, body: { name: "Boss" } }, idParams(id))).status).toBe(409);
    expect((await call(roleRoute.PUT, `/api/admin/roles/${id}`, { method: "PUT", as: owner, body: { grantsAll: false } }, idParams(id))).status).toBe(409);
    expect((await call(roleRoute.PUT, `/api/admin/roles/${id}`, { method: "PUT", as: owner, body: { isActive: false } }, idParams(id))).status).toBe(409);
    expect((await call(roleRoute.DELETE, `/api/admin/roles/${id}`, { method: "DELETE", as: owner }, idParams(id))).status).toBe(409);
    expect(await RoleModel.findById(ownerRole).lean()).toMatchObject({ name: "Owner", grantsAll: true, isActive: true });
  });

  it("refuses to turn off the only OTHER full-access role its sole Owner holds", async () => {
    const admins = await roleWith("Admins", [], true);
    await StaffUserModel.updateOne({ _id: owner._id }, { $set: { roles: [admins._id] } });
    const actor = { _id: owner._id, tokenVersion: owner.tokenVersion };
    const response = await call(roleRoute.PUT, `/api/admin/roles/${admins._id}`, { method: "PUT", as: actor, body: { grantsAll: false } }, idParams(admins._id));
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/last active Owner/);
  });

  it("rejects null for any field instead of storing it — null must never switch the Owner role (or anyone) off", async () => {
    const id = ownerRole.toString();
    for (const body of [{ isActive: null }, { grantsAll: null }, { name: null }, { permissionKeys: null }]) {
      expect((await call(roleRoute.PUT, `/api/admin/roles/${id}`, { method: "PUT", as: owner, body }, idParams(id))).status).toBe(400);
    }
    const ownerId = owner._id.toString();
    for (const body of [{ active: null }, { roleIds: null }, { name: null }]) {
      expect((await call(staffIdRoute.PUT, `/api/admin/staff/${ownerId}`, { method: "PUT", as: owner, body }, idParams(ownerId))).status).toBe(400);
    }
    expect(await RoleModel.findById(ownerRole).lean()).toMatchObject({ grantsAll: true, isActive: true });
    expect((await StaffUserModel.findById(owner._id).lean())!.active).toBe(true);
  });

  it("edits a default role that holds a key no longer offered (Manager's Order.cancel) — kept, not rejected", async () => {
    const manager = (await RoleModel.findOne({ name: "Manager" }).populate("permissions").lean())!;
    const keys = (manager.permissions as unknown as Array<{ key: string }>).map((p) => p.key);
    expect(keys).toContain("Order.cancel");
    const response = await call(roleRoute.PUT, `/api/admin/roles/${manager._id}`, { method: "PUT", as: owner, body: { permissionKeys: [...keys, AppPermission.BRAND.READ] } }, idParams(manager._id));
    expect(response.status).toBe(200);
    const after = response.body.permissions.map((p: { key: string }) => p.key);
    expect(after).toEqual(expect.arrayContaining(["Order.cancel", AppPermission.BRAND.READ]));
    // But it cannot be ADDED to a role that lacks it.
    const support = (await RoleModel.findOne({ name: "Support" }).lean())!;
    expect((await call(roleRoute.PUT, `/api/admin/roles/${support._id}`, { method: "PUT", as: owner, body: { permissionKeys: ["Order.cancel"] } }, idParams(support._id))).status).toBe(400);
  });

  it("lists only assignable permissions for the matrix", async () => {
    const response = await call(permissionsRoute.GET, "/api/admin/permissions", { method: "GET", as: owner });
    expect(response.status).toBe(200);
    const keys = response.body.data.map((p: { key: string }) => p.key);
    expect(keys).toEqual(expect.arrayContaining([AppPermission.PRODUCT.READ, AppPermission.ROLE.CREATE, AppPermission.STAFF_USER.UPDATE, CustomPermission.PAYMENT_REFUND]));
    expect(keys).not.toContain("Wishlist.read");
    expect(keys).not.toContain("Role.manage");
  });
});

describe("permission enforcement on the backend (negative cases)", () => {
  it("a role without the permission gets 403 on every role and staff route; no session gets 401", async () => {
    const viewer = await staffWith([(await roleWith("Viewer", [AppPermission.PRODUCT.READ]))._id]);
    const target = owner._id.toString();
    const roleId = ownerRole.toString();
    const results = [
      await call(rolesRoute.GET, "/api/admin/roles", { method: "GET", as: viewer }),
      await call(rolesRoute.POST, "/api/admin/roles", { method: "POST", as: viewer, body: { name: "X", permissionKeys: [] } }),
      await call(roleRoute.PUT, `/api/admin/roles/${roleId}`, { method: "PUT", as: viewer, body: { name: "X" } }, idParams(roleId)),
      await call(roleRoute.DELETE, `/api/admin/roles/${roleId}`, { method: "DELETE", as: viewer }, idParams(roleId)),
      await call(permissionsRoute.GET, "/api/admin/permissions", { method: "GET", as: viewer }),
      await call(staffRoute.GET, "/api/admin/staff", { method: "GET", as: viewer }),
      await call(staffRoute.POST, "/api/admin/staff", { method: "POST", as: viewer, body: { name: "N", email: "n@example.com" } }),
      await call(directRoute.POST, "/api/admin/staff/direct", { method: "POST", as: viewer, body: { name: "N", email: "n@example.com", password: "a-long-password" } }),
      await call(staffIdRoute.PUT, `/api/admin/staff/${target}`, { method: "PUT", as: viewer, body: { name: "X" } }, idParams(target)),
    ];
    expect(results.map((r) => r.status)).toEqual(Array(results.length).fill(403));
    expect((await call(rolesRoute.GET, "/api/admin/roles", { method: "GET" })).status).toBe(401);
  });

  it("a permission granted through a role takes effect on the next request, and is gone the moment it is removed", async () => {
    const role = await roleWith("Readers", [AppPermission.ROLE.READ]);
    const reader = await staffWith([role._id]);
    expect((await call(rolesRoute.GET, "/api/admin/roles", { method: "GET", as: reader })).status).toBe(200);
    await call(roleRoute.PUT, `/api/admin/roles/${role._id}`, { method: "PUT", as: owner, body: { permissionKeys: [] } }, idParams(role._id));
    expect((await call(rolesRoute.GET, "/api/admin/roles", { method: "GET", as: reader })).status).toBe(403);
  });
});

describe("privilege escalation is refused", () => {
  async function roleAdmin() {
    // Can manage roles and staff, and do a little else — but is not an Owner.
    const keys = [
      AppPermission.ROLE.READ,
      AppPermission.ROLE.CREATE,
      AppPermission.ROLE.UPDATE,
      AppPermission.ROLE.DELETE,
      AppPermission.STAFF_USER.READ,
      AppPermission.STAFF_USER.CREATE,
      AppPermission.STAFF_USER.UPDATE,
      AppPermission.ORDER.READ,
    ];
    const role = await roleWith("Role admins", keys);
    return { role, actor: await staffWith([role._id]) };
  }

  it("cannot create a role with full access or with a permission they lack", async () => {
    const { actor } = await roleAdmin();
    const full = await call(rolesRoute.POST, "/api/admin/roles", { method: "POST", as: actor, body: { name: "Super", permissionKeys: [], grantsAll: true } });
    expect(full.status).toBe(403);
    const beyond = await call(rolesRoute.POST, "/api/admin/roles", { method: "POST", as: actor, body: { name: "Refunders", permissionKeys: [CustomPermission.PAYMENT_REFUND] } });
    expect(beyond.status).toBe(403);
    expect(beyond.body.message).toMatch(/Payment\.refund/);
    const within = await call(rolesRoute.POST, "/api/admin/roles", { method: "POST", as: actor, body: { name: "Order readers", permissionKeys: [AppPermission.ORDER.READ] } });
    expect(within.status).toBe(201);
  });

  it("cannot add permissions to their OWN role, nor edit or delete a role more powerful than themselves", async () => {
    const { role, actor } = await roleAdmin();
    const own = await call(roleRoute.PUT, `/api/admin/roles/${role._id}`, { method: "PUT", as: actor, body: { permissionKeys: [AppPermission.ROLE.UPDATE, CustomPermission.PAYMENT_REFUND] } }, idParams(role._id));
    expect(own.status).toBe(403);
    const manager = (await RoleModel.findOne({ name: "Manager" }).lean())!;
    expect((await call(roleRoute.PUT, `/api/admin/roles/${manager._id}`, { method: "PUT", as: actor, body: { name: "Renamed" } }, idParams(manager._id))).status).toBe(403);
    expect((await call(roleRoute.DELETE, `/api/admin/roles/${manager._id}`, { method: "DELETE", as: actor }, idParams(manager._id))).status).toBe(403);
    expect((await call(roleRoute.PUT, `/api/admin/roles/${ownerRole}`, { method: "PUT", as: actor, body: { name: "Mine" } }, idParams(ownerRole))).status).toBe(403);
  });

  it("cannot make themselves (or anyone) an Owner, by edit, invite or direct creation", async () => {
    const { actor } = await roleAdmin();
    const self = await call(staffIdRoute.PUT, `/api/admin/staff/${actor._id}`, { method: "PUT", as: actor, body: { roleIds: [String(ownerRole)] } }, idParams(actor._id));
    expect(self.status).toBe(403);
    const invite = await call(staffRoute.POST, "/api/admin/staff", { method: "POST", as: actor, body: { name: "Mole", email: "mole@example.com", roleIds: [String(ownerRole)] } });
    expect(invite.status).toBe(403);
    const direct = await call(directRoute.POST, "/api/admin/staff/direct", {
      method: "POST",
      as: actor,
      body: { name: "Mole", email: "mole@example.com", password: "a-long-password", roleIds: [String(ownerRole)] },
    });
    expect(direct.status).toBe(403);
    expect(await StaffUserModel.countDocuments({ email: "mole@example.com" })).toBe(0);
    expect((await StaffUserModel.findById(actor._id).lean())!.roles.map(String)).not.toContain(String(ownerRole));
  });

  it("cannot deactivate, demote or rename an Owner, nor re-invite a pending one to take over the link", async () => {
    const { actor } = await roleAdmin();
    const ownerId = owner._id.toString();
    expect((await call(staffIdRoute.PUT, `/api/admin/staff/${ownerId}`, { method: "PUT", as: actor, body: { active: false } }, idParams(ownerId))).status).toBe(403);
    expect((await call(staffIdRoute.PUT, `/api/admin/staff/${ownerId}`, { method: "PUT", as: actor, body: { roleIds: [] } }, idParams(ownerId))).status).toBe(403);
    expect((await call(staffIdRoute.PUT, `/api/admin/staff/${ownerId}`, { method: "PUT", as: actor, body: { name: "X" } }, idParams(ownerId))).status).toBe(403);

    const pending = await staffWith([ownerRole], { password: null });
    const reinvite = await call(reinviteRoute.POST, `/api/admin/staff/${pending._id}/invite`, { method: "POST", as: actor }, idParams(pending._id));
    expect(reinvite.status).toBe(403);
    expect(reinvite.body.token).toBeUndefined();
  });

  it("may still manage a colleague whose access they cover", async () => {
    const { actor } = await roleAdmin();
    const readers = await roleWith("Order readers", [AppPermission.ORDER.READ]);
    const colleague = await staffWith([]);
    const response = await call(staffIdRoute.PUT, `/api/admin/staff/${colleague._id}`, { method: "PUT", as: actor, body: { roleIds: [String(readers._id)] } }, idParams(colleague._id));
    expect(response.status).toBe(200);
  });

  describe("an in-flight request is judged by the access it was authenticated with AND the access held now", () => {
    const body = { name: "Mole", email: "mole@example.com", password: "a-long-password", mustChangePassword: false };

    it("a request authenticated before its actor was made an Owner cannot act as an Owner", async () => {
      const { actor } = await roleAdmin();
      const requestTime = (await resolveStaffUser(actor._id.toString()))!;
      // Promoted while the request was queued — which also ends the session the request was authenticated with.
      await StaffUserModel.updateOne({ _id: actor._id }, { $set: { roles: [ownerRole] }, $inc: { tokenVersion: 1 } });
      await expect(createStaffDirect({ ...body, roleIds: [String(ownerRole)] }, requestTime)).rejects.toThrow(/access changed/);
      expect(await StaffUserModel.countDocuments({ email: "mole@example.com" })).toBe(0);
    });

    it("a role WIDENED mid-request (no session change) still does not widen the request", async () => {
      const { role, actor } = await roleAdmin();
      const requestTime = (await resolveStaffUser(actor._id.toString()))!;
      await RoleModel.updateOne({ _id: role._id }, { $set: { grantsAll: true } });
      await expect(createStaffDirect({ ...body, roleIds: [String(ownerRole)] }, requestTime)).rejects.toThrow(/full access/);
      expect(await StaffUserModel.countDocuments({ email: "mole@example.com" })).toBe(0);
    });

    it("a request whose actor LOST the route's permission mid-request is refused", async () => {
      const { role, actor } = await roleAdmin();
      const requestTime = (await resolveStaffUser(actor._id.toString()))!;
      const create = await PermissionModel.findOne({ key: AppPermission.STAFF_USER.CREATE }).lean();
      await RoleModel.updateOne({ _id: role._id }, { $pull: { permissions: create!._id } });
      await expect(createStaffDirect(body, requestTime)).rejects.toThrow(/no longer have permission/);
    });
  });

  it("the last Owner still cannot be removed even by another full-access actor's mistake", async () => {
    const response = await call(staffIdRoute.PUT, `/api/admin/staff/${owner._id}`, { method: "PUT", as: owner, body: { roleIds: [] } }, idParams(owner._id));
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/last active Owner/);
  });
});

describe("direct user creation", () => {
  const body = (overrides: Record<string, unknown> = {}) => ({ name: "Nadia", email: "Nadia@Example.com", password: "initial-password-123", ...overrides });

  it("creates an active account with a hashed password, never returns or logs it, and the person can sign in", async () => {
    const manager = (await RoleModel.findOne({ name: "Manager" }).lean())!;
    const created = await call(directRoute.POST, "/api/admin/staff/direct", { method: "POST", as: owner, body: body({ roleIds: [String(manager._id)], mustChangePassword: false }) });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ email: "nadia@example.com", active: true, roles: [expect.objectContaining({ name: "Manager" })] });
    expect(JSON.stringify(created.body)).not.toMatch(/initial-password-123|passwordHash|scrypt/);

    const stored = await StaffUserModel.findOne({ email: "nadia@example.com" }).select("+passwordHash").lean();
    expect(stored!.passwordHash).toBeTruthy();
    expect(stored!.passwordHash).not.toContain("initial-password-123");
    expect(await comparePassword("initial-password-123", stored!.passwordHash!)).toBe(true);
    expect(stored!.mustChangePassword).toBeUndefined();

    const audit = await ActivityLogModel.findOne({ entityType: "StaffUser", action: "create" }).lean();
    expect(JSON.stringify(audit!.changes)).not.toContain("initial-password-123");

    const login = await call(loginRoute.POST, "/api/admin/auth/login", { method: "POST", body: { email: "nadia@example.com", password: "initial-password-123" } });
    expect(login.status).toBe(200);
  });

  it("rejects a duplicate email (409), a short password (400) and an unknown role (400)", async () => {
    await call(directRoute.POST, "/api/admin/staff/direct", { method: "POST", as: owner, body: body() });
    expect((await call(directRoute.POST, "/api/admin/staff/direct", { method: "POST", as: owner, body: body() })).status).toBe(409);
    expect((await call(directRoute.POST, "/api/admin/staff/direct", { method: "POST", as: owner, body: body({ email: "b@example.com", password: "short" }) })).status).toBe(400);
    expect((await call(directRoute.POST, "/api/admin/staff/direct", { method: "POST", as: owner, body: body({ email: "c@example.com", roleIds: [String(new mongoose.Types.ObjectId())] }) })).status).toBe(400);
  });

  it("by default the account must change its password first: every permissioned route refuses it until it does", async () => {
    const manager = (await RoleModel.findOne({ name: "Manager" }).lean())!;
    await call(directRoute.POST, "/api/admin/staff/direct", { method: "POST", as: owner, body: body({ roleIds: [String(manager._id)] }) });
    const person = (await StaffUserModel.findOne({ email: "nadia@example.com" }).lean())!;
    expect(person.mustChangePassword).toBe(true);

    expect((await call(ordersRoute.GET, "/api/admin/orders", { method: "GET", as: person })).status).toBe(403);
    const account = await call(accountRoute.GET, "/api/admin/account", { method: "GET", as: person });
    expect(account.status).toBe(200);
    expect(account.body).toMatchObject({ mustChangePassword: true, effectivePermissions: [], roles: [expect.objectContaining({ name: "Manager" })] });

    const changed = await call(passwordRoute.PUT, "/api/admin/account/password", { method: "PUT", as: person, body: { currentPassword: "initial-password-123", newPassword: "my-own-password-456" } });
    expect(changed.status).toBe(204);
    const after = (await StaffUserModel.findById(person._id).lean())!;
    expect(after.mustChangePassword).toBeUndefined();
    expect((await call(ordersRoute.GET, "/api/admin/orders", { method: "GET", as: after })).status).toBe(200);
  });
});

describe("invitation flow regression", () => {
  it("inviting still creates a password-less account and returns the one-time link to the inviter", async () => {
    const response = await call(staffRoute.POST, "/api/admin/staff", { method: "POST", as: owner, body: { name: "Invitee", email: "invitee@example.com" } });
    expect(response.status).toBe(201);
    expect(response.body.invitation.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const stored = await StaffUserModel.findOne({ email: "invitee@example.com" }).select("+passwordHash").lean();
    expect(stored!.passwordHash).toBeUndefined();
    expect(stored!.mustChangePassword).toBeUndefined();

    const reinvite = await call(reinviteRoute.POST, `/api/admin/staff/${stored!._id}/invite`, { method: "POST", as: owner }, idParams(stored!._id));
    expect(reinvite.status).toBe(200);
    expect(reinvite.body.token).not.toBe(response.body.invitation.token);
  });
});

describe("my account", () => {
  it("shows the caller's own profile, roles and effective permissions — and only theirs", async () => {
    const role = await roleWith("Readers", [AppPermission.ORDER.READ, AppPermission.ORDER.READ_ONE]);
    const me = await staffWith([role._id]);
    const response = await call(accountRoute.GET, "/api/admin/account", { method: "GET", as: me });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ _id: me._id.toString(), email: me.email, grantsAll: false, mustChangePassword: false });
    expect(response.body.effectivePermissions).toEqual([AppPermission.ORDER.READ, AppPermission.ORDER.READ_ONE].sort());
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|tokenVersion/);
    expect((await call(accountRoute.GET, "/api/admin/account", { method: "GET" })).status).toBe(401);
  });

  it("updates only the caller's own name; an id in the body is ignored, and email cannot be changed here", async () => {
    const me = await staffWith([]);
    const response = await call(accountRoute.PUT, "/api/admin/account", { method: "PUT", as: me, body: { name: "  Renamed  " } });
    expect(response.status).toBe(200);
    expect(response.body.name).toBe("Renamed");
    expect((await StaffUserModel.findById(owner._id).lean())!.name).toBe("Staff");

    const sneaky = await call(accountRoute.PUT, "/api/admin/account", { method: "PUT", as: me, body: { name: "X", _id: owner._id.toString(), email: "x@example.com" } });
    expect(sneaky.status).toBe(400); // unknown properties are rejected outright
    expect((await StaffUserModel.findById(owner._id).lean())!.name).toBe("Staff");
    expect((await StaffUserModel.findById(me._id).lean())!.email).toBe(me.email);
  });

  it("changes the password only with the current one, signs out every other session, keeps this one", async () => {
    const me = await staffWith([]);
    // A session on another device.
    await issueRefreshToken({ model: StaffRefreshTokenModel, subjectId: me._id, ttlMs: 60_000 });

    const wrong = await call(passwordRoute.PUT, "/api/admin/account/password", { method: "PUT", as: me, body: { currentPassword: "not-my-password", newPassword: "brand-new-password" } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toMatch(/current password/);
    const same = await call(passwordRoute.PUT, "/api/admin/account/password", { method: "PUT", as: me, body: { currentPassword: PASSWORD, newPassword: PASSWORD } });
    expect(same.status).toBe(400);
    const weak = await call(passwordRoute.PUT, "/api/admin/account/password", { method: "PUT", as: me, body: { currentPassword: PASSWORD, newPassword: "short" } });
    expect(weak.status).toBe(400);

    jar.clear();
    const ok = await call(passwordRoute.PUT, "/api/admin/account/password", { method: "PUT", as: me, body: { currentPassword: PASSWORD, newPassword: "brand-new-password" } });
    expect(ok.status).toBe(204);

    const stored = (await StaffUserModel.findById(me._id).select("+passwordHash").lean())!;
    expect(await comparePassword("brand-new-password", stored.passwordHash!)).toBe(true);
    expect(stored.tokenVersion).toBe(me.tokenVersion + 1);
    // The old access token is dead; this device got fresh cookies.
    expect((await call(accountRoute.GET, "/api/admin/account", { method: "GET", as: me })).status).toBe(401);
    expect(jar.get(STAFF_SESSION_COOKIE)?.value).toBeTruthy();
    expect(jar.get(STAFF_REFRESH_COOKIE)?.value).toBeTruthy();
    const fresh = await call(accountRoute.GET, "/api/admin/account", { method: "GET", cookies: { [STAFF_SESSION_COOKIE]: jar.get(STAFF_SESSION_COOKIE)!.value } });
    expect(fresh.status).toBe(200);
    // Every refresh token issued before the change is revoked; only this device's fresh one is live.
    const live = await StaffRefreshTokenModel.find({ subjectId: me._id, revokedAt: { $exists: false } }).lean();
    expect(live).toHaveLength(1);

    const audit = await ActivityLogModel.findOne({ action: "changeOwnPassword" }).lean();
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit!.changes)).not.toMatch(/brand-new-password|correct-horse/);
  });

  it("a refresh family started before the password change cannot be renewed, even if it escaped the revocation sweep", async () => {
    const me = await staffWith([]);
    // A session on another device, as a stolen refresh token would be.
    const stolen = await issueRefreshToken({ model: StaffRefreshTokenModel, subjectId: me._id, ttlMs: 7 * 24 * 60 * 60 * 1000 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await call(passwordRoute.PUT, "/api/admin/account/password", { method: "PUT", as: me, body: { currentPassword: PASSWORD, newPassword: "brand-new-password" } })).status).toBe(204);
    // The race's end state: a rotation in flight inserted its successor just AFTER the change revoked everything.
    await StaffRefreshTokenModel.updateMany({ familyId: stolen.familyId }, { $unset: { revokedAt: "" } });

    jar.clear();
    const renewed = await call(refreshRoute.POST, "/api/admin/auth/token/refresh", { method: "POST", cookies: { [STAFF_REFRESH_COOKIE]: stolen.token } });
    expect(renewed.status).toBe(401);
    expect(await StaffRefreshTokenModel.countDocuments({ familyId: stolen.familyId, revokedAt: { $exists: false } })).toBe(0);

    // The session issued BY the change is newer than it, and keeps working.
    const own = await StaffRefreshTokenModel.findOne({ subjectId: me._id, familyId: { $ne: stolen.familyId }, revokedAt: { $exists: false } }).lean();
    expect(own).toBeTruthy();
  });

  it("rate limits password guesses per account", async () => {
    const me = await staffWith([]);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      statuses.push((await call(passwordRoute.PUT, "/api/admin/account/password", { method: "PUT", as: me, body: { currentPassword: `guess-${attempt}-xxxx`, newPassword: "brand-new-password" } })).status);
    }
    expect(statuses.slice(0, 8)).toEqual(Array(8).fill(400));
    expect(statuses.slice(8)).toEqual([429, 429]);
  });
});
