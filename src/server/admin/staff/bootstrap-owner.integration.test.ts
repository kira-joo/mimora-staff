import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertConfirmed,
  bootstrapOwner,
  BootstrapRefusal,
  COLLECTIONS,
  type BootstrapOptions,
  type BootstrapOutcome,
  describeTarget,
  hashInviteToken,
  INVITE_TTL_MS,
  LOCK_COLLECTION,
  OWNER_ROLE,
  parseArgs,
} from "../../../../scripts/admin/bootstrap-owner-core.mjs";
import { ALL_PERMISSION_DEFINITIONS } from "../../../common/authorization/authorization-registry";
import { connectToDatabase } from "../../core/db/connect";
import { PermissionModel, RoleModel } from "../../core/authorization/role.model";
import { reconcilePermissions } from "../../core/authorization/reconcile-permissions";
import { ActivityLogModel } from "../../core/activity-log.schema";
import { STAFF_INVITE_TOKEN_TTL_MS } from "../../core/auth/staff-auth.constants";
import { StaffUserModel } from "../../identity/staff-user.schema";
import { hashVerificationToken } from "../../shop/auth/hash-verification-token";
import { acceptStaffInvite, loginStaff } from "../auth/staff-auth";
import { seedDefaultRoles } from "./seed-default-roles";
import { configureToolkit } from "../../core/toolkit.config";

/*
 * The first-Owner bootstrap (approved design, 2026-10-22): a pending invitation completed by the Owner
 * through the real /accept-invite flow. These tests drive the script's core against a real replica set
 * and finish every path with the APPLICATION's own accept/login code, so the two cannot drift apart.
 */
// loginStaff issues a session cookie through next/headers, which only exists inside a request.
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }) }));

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";

const client = () => mongoose.connection.getClient() as unknown as Parameters<typeof bootstrapOwner>[0];
const db = () => mongoose.connection.db as unknown as Parameters<typeof bootstrapOwner>[1];
const T0 = new Date("2026-10-22T10:00:00Z");
type Created = Extract<BootstrapOutcome, { action: "created" | "reissued" }>;
const run = (options: Partial<BootstrapOptions> = {}) => bootstrapOwner(client(), db(), { email: "owner@store.example", name: "Store Owner", now: T0, ...options });
/** A run that must create (or re-issue): narrows the outcome to one that carries a code. */
const create = async (options: Partial<BootstrapOptions> = {}) => {
  const outcome = await run(options);
  if (outcome.action === "would-create") throw new Error("expected a write");
  return outcome as Created;
};

beforeAll(async () => {
  configureToolkit(); // what the backend does at boot; loginStaff needs it
  await connectToDatabase();
});
beforeEach(async () => {
  await Promise.all([StaffUserModel.deleteMany({}), ActivityLogModel.deleteMany({}), RoleModel.deleteMany({}), PermissionModel.deleteMany({}), mongoose.connection.db!.collection(LOCK_COLLECTION).deleteMany({})]);
  // Exactly what the backend does at boot (src/instrumentation.ts).
  await reconcilePermissions({ model: PermissionModel, definitions: ALL_PERMISSION_DEFINITIONS });
  await seedDefaultRoles();
});
afterAll(async () => {
  await Promise.all([StaffUserModel.deleteMany({}), ActivityLogModel.deleteMany({}), RoleModel.deleteMany({}), PermissionModel.deleteMany({})]);
  await mongoose.disconnect();
});

describe("the script's copies of application values cannot drift", () => {
  it("token hash, invitation lifetime, collection names and the Owner role name match the application", async () => {
    expect(hashInviteToken("abc-123")).toBe(hashVerificationToken("abc-123"));
    expect(INVITE_TTL_MS).toBe(STAFF_INVITE_TOKEN_TTL_MS);
    expect(COLLECTIONS).toEqual({ staff: StaffUserModel.collection.name, roles: RoleModel.collection.name, activity: ActivityLogModel.collection.name });
    expect(await RoleModel.exists({ name: OWNER_ROLE })).toBeTruthy();
  });
});

describe("bootstrapping the first Owner", () => {
  it("creates a pending Owner: Owner role, no password, only the code's hash, one-hour expiry, audited without the code", async () => {
    const result = await create();
    expect(result.action).toBe("created");

    const owner = await StaffUserModel.findById(result.staffId).select("+passwordHash +passwordResetTokenHash +passwordResetExpiresAt").lean();
    const ownerRole = await RoleModel.findOne({ name: OWNER_ROLE }).lean();
    expect(owner).toMatchObject({ email: "owner@store.example", name: "Store Owner", active: true, tokenVersion: 1 });
    expect(owner!.roles.map(String)).toEqual([ownerRole!._id.toString()]);
    expect(owner!.passwordHash).toBeUndefined();
    expect(owner!.passwordResetTokenHash).toBe(hashVerificationToken(result.token));
    expect(owner!.passwordResetTokenHash).not.toContain(result.token);
    expect(owner!.passwordResetExpiresAt!.getTime()).toBe(T0.getTime() + STAFF_INVITE_TOKEN_TTL_MS);

    const audit = await ActivityLogModel.find({}).lean();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "bootstrap-owner", entityType: "StaffUser" });
    expect(audit[0]!.actorId.toString()).toBe(result.staffId.toString());
    expect(JSON.stringify(audit)).not.toContain(result.token);
  });

  it("the Owner completes it through the REAL accept-invite flow and signs in; the code then cannot be used again", async () => {
    const { token, staffId } = await create();
    await acceptStaffInvite(token, "a-strong-owner-password", new Date(T0.getTime() + 5 * 60_000));

    expect((await loginStaff("owner@store.example", "a-strong-owner-password", new Date())).toString()).toBe(staffId.toString());
    await expect(acceptStaffInvite(token, "another-password-123", new Date(T0.getTime() + 6 * 60_000))).rejects.toThrow();
  });

  it("an expired code is refused by the real flow", async () => {
    const { token } = await create();
    await expect(acceptStaffInvite(token, "a-strong-owner-password", new Date(T0.getTime() + INVITE_TTL_MS + 1))).rejects.toThrow();
  });

  it("refuses when an Owner already exists, whatever the email", async () => {
    await run();
    await expect(run({ email: "second@store.example" })).rejects.toBeInstanceOf(BootstrapRefusal);
    expect(await StaffUserModel.countDocuments({})).toBe(1);
  });

  it("refuses when the email already belongs to a staff member", async () => {
    await StaffUserModel.create({ email: "owner@store.example", name: "Existing", roles: [] });
    await expect(run()).rejects.toThrow(/already exists/);
  });

  it("refuses on a database the backend never booted against (no Owner role)", async () => {
    await RoleModel.deleteMany({});
    await expect(run()).rejects.toThrow(/No Owner role/);
    expect(await StaffUserModel.countDocuments({})).toBe(0);
  });

  it("refuses an invalid email", async () => {
    await expect(run({ email: "not-an-email" })).rejects.toBeInstanceOf(BootstrapRefusal);
  });

  it("a dry run writes nothing at all", async () => {
    const result = await run({ dryRun: true });
    expect(result.action).toBe("would-create");
    expect(result).not.toHaveProperty("token");
    expect(await StaffUserModel.countDocuments({})).toBe(0);
    expect(await ActivityLogModel.countDocuments({})).toBe(0);
    expect(await mongoose.connection.db!.collection(LOCK_COLLECTION).countDocuments({})).toBe(0); // not even the lock
  });

  it("--reissue replaces an un-activated Owner's code: the old code dies, the new one works", async () => {
    const first = await create();
    const second = await create({ reissue: true, now: new Date(T0.getTime() + 2 * INVITE_TTL_MS) });
    expect(second.action).toBe("reissued");
    expect(second.token).not.toBe(first.token);

    const later = new Date(T0.getTime() + 2 * INVITE_TTL_MS + 60_000);
    await expect(acceptStaffInvite(first.token, "a-strong-owner-password", later)).rejects.toThrow();
    await acceptStaffInvite(second.token, "a-strong-owner-password", later);
    expect(await ActivityLogModel.countDocuments({ action: "reissue-owner-invitation" })).toBe(1);
  });

  it("--reissue never becomes a password reset for an Owner who already activated", async () => {
    const { token } = await create();
    await acceptStaffInvite(token, "a-strong-owner-password", new Date(T0.getTime() + 60_000));
    await expect(run({ reissue: true })).rejects.toThrow(/already activated/);
  });

  it("CONCURRENT: three operators bootstrapping at once produce exactly one Owner", async () => {
    for (let round = 0; round < 3; round++) {
      await StaffUserModel.deleteMany({});
      const results = await Promise.allSettled(["a@store.example", "b@store.example", "c@store.example"].map((email) => run({ email })));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((r): r is PromiseRejectedResult => r.status === "rejected")) expect(r.reason).toBeInstanceOf(BootstrapRefusal);
      expect(await StaffUserModel.countDocuments({})).toBe(1);
    }
  });
});

describe("the production guard", () => {
  it("treats only localhost + a dev/test/fixture database name as local", () => {
    expect(describeTarget("mongodb://localhost:27020/?replicaSet=rs0", "store-platform-staff-dev").local).toBe(true);
    expect(describeTarget("mongodb://127.0.0.1:27017", "store-fixture-b").local).toBe(true);
    expect(describeTarget("mongodb://localhost:27020", "store-platform-staff").local).toBe(false); // a production-like name
    expect(describeTarget("mongodb+srv://user:pw@cluster0.example.mongodb.net", "store-dev").local).toBe(false); // srv is never local
    expect(describeTarget("mongodb://db.internal:27017", "store-platform-staff-dev").local).toBe(false);
  });

  it("a non-local target needs --confirm-production with the EXACT database name", () => {
    const target = describeTarget("mongodb+srv://user:pw@cluster0.example.mongodb.net", "hirfa-prod");
    expect(() => assertConfirmed(target, undefined)).toThrow(/--confirm-production=hirfa-prod/);
    expect(() => assertConfirmed(target, true)).toThrow(BootstrapRefusal); // a bare flag is not a confirmation
    expect(() => assertConfirmed(target, "hirfa-staging")).toThrow(BootstrapRefusal);
    expect(() => assertConfirmed(target, "hirfa-prod")).not.toThrow();
    expect(() => assertConfirmed(describeTarget("mongodb://localhost:27020", "x-dev"), undefined)).not.toThrow();
  });

  it("never echoes credentials from the URI in its refusal", () => {
    const target = describeTarget("mongodb+srv://admin:s3cret-pass@cluster0.example.mongodb.net", "prod");
    expect(() => assertConfirmed(target, undefined)).toThrow(expect.objectContaining({ message: expect.not.stringContaining("s3cret") }));
  });
});

describe("command-line arguments", () => {
  it("accepts --key value and --key=value, and bare flags", () => {
    expect(parseArgs(["--email", "a@b.example", "--name=Store Owner", "--dry-run"])).toEqual({ email: "a@b.example", name: "Store Owner", "dry-run": true });
    expect(parseArgs(["--confirm-production=hirfa-prod", "--reissue", "--email=x@y.example"])).toEqual({ "confirm-production": "hirfa-prod", reissue: true, email: "x@y.example" });
  });

  it("refuses a missing value, an unknown or mistyped option, a value on a flag, and stray words", () => {
    expect(() => parseArgs(["--email"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--email", "--dry-run"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--confirm-producton=prod"])).toThrow(/Unknown option/); // a typo must not read as "unconfirmed, carry on"
    expect(() => parseArgs(["--dry-run=yes"])).toThrow(/takes no value/);
    expect(() => parseArgs(["owner@store.example"])).toThrow(/Unexpected argument/);
  });
});
