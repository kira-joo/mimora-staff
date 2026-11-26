// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { RoleModel, PermissionModel } from "../../core/authorization/role.model";
import { reconcilePermissions } from "../../core/authorization/reconcile-permissions";
import { ALL_PERMISSION_DEFINITIONS, AppPermission, CustomPermission } from "../../../common/authorization/authorization-registry";
import { DefaultRoleSeedModel } from "../../core/authorization/default-role-seed.schema";
import { DEFAULT_ROLE_DEFINITIONS, LEGACY_STAFF_MANAGE_KEY, migrateLegacyStaffManage, seedDefaultRoles } from "./seed-default-roles";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
  await Promise.all([RoleModel.deleteMany({}), DefaultRoleSeedModel.deleteMany({})]);
  await reconcilePermissions({ model: PermissionModel, definitions: ALL_PERMISSION_DEFINITIONS });
});

afterEach(async () => {
  await Promise.all([RoleModel.deleteMany({}), DefaultRoleSeedModel.deleteMany({})]);
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

  it("adopts an existing database's default roles exactly as they stand — nothing added, nothing removed — then remembers", async () => {
    await seedDefaultRoles();
    // As production looks on the first boot of this release: roles exist, no seed records, an edited permission set.
    await DefaultRoleSeedModel.deleteMany({});
    const orderRead = await PermissionModel.findOne({ key: AppPermission.ORDER.READ }).lean();
    const merchantExtra = await PermissionModel.findOne({ key: AppPermission.BRAND.DELETE }).lean();
    await RoleModel.updateOne({ name: "Fulfilment" }, { $set: { permissions: [orderRead!._id, merchantExtra!._id] } });
    const before = JSON.stringify(await RoleModel.find({}).sort({ name: 1 }).lean());

    const result = await seedDefaultRoles();

    expect(result.created).toEqual([]);
    expect(result.permissionsAdded).toEqual({});
    expect(JSON.stringify(await RoleModel.find({}).sort({ name: 1 }).lean())).toBe(before);
    expect(await DefaultRoleSeedModel.countDocuments()).toBe(5);
    // And the missing defaults are not added on any later boot either.
    expect((await seedDefaultRoles()).permissionsAdded).toEqual({});
  });

  it("a permission the merchant REMOVED from a default role stays removed across boots", async () => {
    await seedDefaultRoles();
    const transition = await PermissionModel.findOne({ key: CustomPermission.ORDER_TRANSITION }).lean();
    await RoleModel.updateOne({ name: "Fulfilment" }, { $pull: { permissions: transition!._id } });

    const result = await seedDefaultRoles();

    expect(result.permissionsAdded).toEqual({});
    const after = await RoleModel.findOne({ name: "Fulfilment" }).lean();
    expect(after?.permissions.map(String)).not.toContain(String(transition!._id));
  });

  it("a renamed default role is found by id and not recreated; a deleted one is not resurrected", async () => {
    await seedDefaultRoles();
    await RoleModel.updateOne({ name: "Manager" }, { $set: { name: "Store manager" } });
    await RoleModel.deleteOne({ name: "Support" });

    const result = await seedDefaultRoles();

    expect(result.created).toEqual([]);
    expect(await RoleModel.countDocuments({ name: "Manager" })).toBe(0);
    expect(await RoleModel.countDocuments({ name: "Store manager" })).toBe(1);
    expect(await RoleModel.countDocuments({ name: "Support" })).toBe(0);
  });

  it("a key a NEW release adds to a definition is granted once, even to a renamed role, and never again after removal", async () => {
    await seedDefaultRoles();
    await RoleModel.updateOne({ name: "Fulfilment" }, { $set: { name: "Packers" } });
    const nextRelease = DEFAULT_ROLE_DEFINITIONS.map((role) =>
      role.name === "Fulfilment" ? { ...role, permissionKeys: [...(role.permissionKeys ?? []), CustomPermission.ORDER_EXPORT] } : role
    );

    const first = await seedDefaultRoles(nextRelease);
    expect(first.permissionsAdded).toEqual({ Fulfilment: [CustomPermission.ORDER_EXPORT] });
    const exportPermission = await PermissionModel.findOne({ key: CustomPermission.ORDER_EXPORT }).lean();
    expect((await RoleModel.findOne({ name: "Packers" }).lean())?.permissions.map(String)).toContain(String(exportPermission!._id));

    await RoleModel.updateOne({ name: "Packers" }, { $pull: { permissions: exportPermission!._id } });
    const second = await seedDefaultRoles(nextRelease);
    expect(second.permissionsAdded).toEqual({});
    expect((await RoleModel.findOne({ name: "Packers" }).lean())?.permissions.map(String)).not.toContain(String(exportPermission!._id));
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
    await DefaultRoleSeedModel.deleteMany({});
    await RoleModel.updateOne({ name: "Manager" }, { $set: { isActive: false, grantsAll: true, permissions: [] } });
    await RoleModel.create({ name: "Custom role", grantsAll: false, permissions: [], isActive: true });

    await seedDefaultRoles();

    const manager = await RoleModel.findOne({ name: "Manager" }).lean();
    expect(manager?.isActive).toBe(false);
    expect(manager?.grantsAll).toBe(true);
    expect(manager?.permissions).toEqual([]); // adopted as it stands
    const custom = await RoleModel.findOne({ name: "Custom role" }).lean();
    expect(custom?.permissions).toEqual([]);
    expect(await RoleModel.countDocuments({ name: "Custom role" })).toBe(1);
  });

  it("re-ensures the Owner role if it ever goes missing — bootstrap-owner depends on it", async () => {
    await seedDefaultRoles();
    await RoleModel.deleteOne({ name: "Owner" });

    const result = await seedDefaultRoles();

    expect(result.created).toEqual(["Owner"]);
    const owner = await RoleModel.findOne({ name: "Owner" }).lean();
    expect(owner?.grantsAll).toBe(true);
    expect(String((await DefaultRoleSeedModel.findOne({ definition: "Owner" }).lean())?.roleId)).toBe(String(owner?._id));
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

describe("migrateLegacyStaffManage", () => {
  const legacyPermission = (isActive = true) =>
    PermissionModel.findOneAndUpdate(
      { key: LEGACY_STAFF_MANAGE_KEY },
      { $set: { isActive }, $setOnInsert: { key: LEGACY_STAFF_MANAGE_KEY, entity: "StaffUser", action: "manage", name: "Manage Staff", isSystem: false } },
      { upsert: true, new: true }
    ).lean();
  const keys = async (id: mongoose.Types.ObjectId) =>
    ((await RoleModel.findById(id).populate("permissions").lean())?.permissions as unknown as Array<{ key: string }>).map((p) => p.key).sort();

  it("gives an active role that held an active StaffUser.manage the granular staff permissions, then retires the legacy key", async () => {
    const legacy = await legacyPermission();
    const other = await PermissionModel.findOne({ key: AppPermission.ORDER.READ }).lean();
    const holder = await RoleModel.create({ name: "Legacy admins", grantsAll: false, permissions: [legacy!._id, other!._id], isActive: true });
    const bystander = await RoleModel.create({ name: "Bystander", grantsAll: false, permissions: [other!._id], isActive: true });

    expect(await migrateLegacyStaffManage()).toEqual({ rolesUpdated: 1 });
    expect(await keys(holder._id)).toEqual(
      [AppPermission.ORDER.READ, AppPermission.STAFF_USER.READ, AppPermission.STAFF_USER.READ_ONE, AppPermission.STAFF_USER.CREATE, AppPermission.STAFF_USER.UPDATE].sort()
    );
    expect(await keys(bystander._id)).toEqual([AppPermission.ORDER.READ]);

    // Runs once: an Owner then removes a replacement, and the next boot does not put it back.
    const create = await PermissionModel.findOne({ key: AppPermission.STAFF_USER.CREATE }).lean();
    await RoleModel.updateOne({ _id: holder._id }, { $pull: { permissions: create!._id } });
    expect(await migrateLegacyStaffManage()).toEqual({ rolesUpdated: 0 });
    expect(await keys(holder._id)).not.toContain(AppPermission.STAFF_USER.CREATE);
    await PermissionModel.deleteOne({ key: LEGACY_STAFF_MANAGE_KEY });
  });

  it("grants nothing for a legacy permission that was switched off, nor to an inactive role", async () => {
    const legacy = await legacyPermission(false);
    const disabledGrant = await RoleModel.create({ name: "Disabled grant", grantsAll: false, permissions: [legacy!._id], isActive: true });
    await migrateLegacyStaffManage();
    expect(await keys(disabledGrant._id)).toEqual([]);

    const live = await legacyPermission(true);
    const inactiveRole = await RoleModel.create({ name: "Inactive role", grantsAll: false, permissions: [live!._id], isActive: false });
    await migrateLegacyStaffManage();
    expect(await keys(inactiveRole._id)).toEqual([]);
    await PermissionModel.deleteOne({ key: LEGACY_STAFF_MANAGE_KEY });
  });

  it("does nothing when the legacy permission was never stored", async () => {
    await PermissionModel.deleteOne({ key: LEGACY_STAFF_MANAGE_KEY });
    expect(await migrateLegacyStaffManage()).toEqual({ rolesUpdated: 0 });
  });
});
