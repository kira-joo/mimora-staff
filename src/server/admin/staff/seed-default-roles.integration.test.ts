// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { RoleModel, PermissionModel } from "../../core/authorization/role.model";
import { reconcilePermissions } from "../../core/authorization/reconcile-permissions";
import { ALL_PERMISSION_DEFINITIONS, AppPermission, CustomPermission } from "../../../common/authorization/authorization-registry";
import { seedDefaultRoles } from "./seed-default-roles";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
  await reconcilePermissions({ model: PermissionModel, definitions: ALL_PERMISSION_DEFINITIONS });
});

afterEach(async () => {
  await RoleModel.deleteMany({});
});

afterAll(async () => {
  // `instrumentation.integration.test.ts` assumes an empty PermissionModel
  // at the start of its own run (afterEach-only cleanup, matching how it
  // was found and fixed once already for promotions/get-active-promotions).
  // This file's `beforeAll` seeds PermissionModel once, so it must undo
  // that here rather than leave state for whichever suite runs next under
  // `fileParallelism: false`.
  await PermissionModel.deleteMany({});
  await mongoose.disconnect();
});

describe("seedDefaultRoles", () => {
  it("creates the five default personas on first run", async () => {
    const result = await seedDefaultRoles();

    expect(result.created.sort()).toEqual(["Fulfilment", "Manager", "Merchandiser", "Owner", "Support"].sort());
    expect(result.skipped).toEqual([]);

    const roles = await RoleModel.find({}).lean();
    expect(roles).toHaveLength(5);
  });

  it("gives Owner grantsAll and no enumerated permissions", async () => {
    await seedDefaultRoles();

    const owner = await RoleModel.findOne({ name: "Owner" }).lean();
    expect(owner?.grantsAll).toBe(true);
    expect(owner?.permissions).toEqual([]);
  });

  it("resolves Manager's permission keys to real Permission document ids", async () => {
    await seedDefaultRoles();

    const manager = await RoleModel.findOne({ name: "Manager" }).populate("permissions").lean();
    const keys = (manager?.permissions as unknown as Array<{ key: string }>).map((p) => p.key);
    expect(keys).toContain(AppPermission.ORDER.READ);
    expect(keys).toContain(AppPermission.PROMOTION.DELETE);
  });

  it("is ADDITIVE only: a default role missing default permissions regains them, and nothing a merchant added is removed", async () => {
    await seedDefaultRoles();
    const orderRead = await PermissionModel.findOne({ key: AppPermission.ORDER.READ }).lean();
    const merchantExtra = await PermissionModel.findOne({ key: AppPermission.BRAND.DELETE }).lean(); // not a default of Fulfilment
    const before = await RoleModel.findOne({ name: "Fulfilment" }).lean();
    // As a database seeded before `Notification.read` existed looks: the role has an older subset, plus one merchant-added permission.
    await RoleModel.updateOne({ name: "Fulfilment" }, { $set: { permissions: [orderRead!._id, merchantExtra!._id] } });

    const result = await seedDefaultRoles();

    expect(result.created).toEqual([]);
    expect(result.skipped.sort()).toEqual(["Fulfilment", "Manager", "Merchandiser", "Owner", "Support"].sort());
    expect(result.permissionsAdded.Fulfilment?.sort()).toEqual([AppPermission.ORDER.READ_ONE, CustomPermission.ORDER_TRANSITION, CustomPermission.NOTIFICATION_READ].sort());
    expect(Object.keys(result.permissionsAdded)).toEqual(["Fulfilment"]); // the other roles already had everything

    const after = await RoleModel.findOne({ name: "Fulfilment" }).populate("permissions").lean();
    const keys = (after?.permissions as unknown as Array<{ key: string }>).map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining([AppPermission.ORDER.READ, AppPermission.ORDER.READ_ONE, CustomPermission.ORDER_TRANSITION, CustomPermission.NOTIFICATION_READ, AppPermission.BRAND.DELETE]));
    expect(keys).toHaveLength(5);
    expect(before?.permissions).toHaveLength(4);
  });

  it("is idempotent: a second run adds nothing and leaves every role byte-for-byte as it was", async () => {
    await seedDefaultRoles();
    const snapshot = JSON.stringify(await RoleModel.find({}).sort({ name: 1 }).lean());

    const result = await seedDefaultRoles();

    expect(result.permissionsAdded).toEqual({});
    expect(JSON.stringify(await RoleModel.find({}).sort({ name: 1 }).lean())).toBe(snapshot);
  });

  it("never touches grantsAll, isActive or the name of an existing default role, nor a role under any other name", async () => {
    await seedDefaultRoles();
    await RoleModel.updateOne({ name: "Manager" }, { $set: { isActive: false, grantsAll: true, permissions: [] } });
    await RoleModel.create({ name: "Custom role", grantsAll: false, permissions: [], isActive: true });

    await seedDefaultRoles();

    const manager = await RoleModel.findOne({ name: "Manager" }).lean();
    expect(manager?.isActive).toBe(false);
    expect(manager?.grantsAll).toBe(true);
    expect(manager?.permissions.length).toBeGreaterThan(0); // missing defaults were added...
    const custom = await RoleModel.findOne({ name: "Custom role" }).lean();
    expect(custom?.permissions).toEqual([]); // ...but only for the default names
    expect(await RoleModel.countDocuments({ name: "Custom role" })).toBe(1);
  });

  it("never gives an enumerated permission list to Owner, whatever happened to it", async () => {
    await seedDefaultRoles();
    await seedDefaultRoles();
    const owner = await RoleModel.findOne({ name: "Owner" }).lean();
    expect(owner?.permissions).toEqual([]);
    expect(owner?.grantsAll).toBe(true);
  });

  it("converges safely under concurrent cold starts", async () => {
    await Promise.all([seedDefaultRoles(), seedDefaultRoles(), seedDefaultRoles()]);

    const owners = await RoleModel.find({ name: "Owner" }).lean();
    expect(owners).toHaveLength(1);
  });
});
