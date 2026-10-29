// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../db/connect";
import { PermissionModel, RoleModel } from "../authorization/role.model";
import { StaffUserModel } from "../../identity/staff-user.schema";
import { AppPermission } from "../../../common/authorization/authorization-registry";
import { resolveStaffUser } from "./resolve-staff-user";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([StaffUserModel.deleteMany({}), RoleModel.deleteMany({}), PermissionModel.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

async function createStaffUser(overrides: { active?: boolean; roleIds?: mongoose.Types.ObjectId[] } = {}) {
  const user = await StaffUserModel.create({
    email: `staff-${new mongoose.Types.ObjectId().toString()}@example.com`,
    passwordHash: "irrelevant-for-this-test",
    name: "Test Staff",
    roles: overrides.roleIds ?? [],
    active: overrides.active ?? true,
  });
  return user._id as mongoose.Types.ObjectId;
}

describe("resolveStaffUser", () => {
  it("returns null for a user that does not exist", async () => {
    expect(await resolveStaffUser(new mongoose.Types.ObjectId().toString())).toBeNull();
  });

  it("returns null for a deactivated staff user — takes effect immediately, not on token expiry", async () => {
    const userId = await createStaffUser({ active: false });
    expect(await resolveStaffUser(userId.toString())).toBeNull();
  });

  it("resolves a fresh read from the database, not a cached/claimed value", async () => {
    const productPermission = await PermissionModel.create({
      key: AppPermission.PRODUCT.READ,
      entity: "Product",
      action: "read",
      name: "Read Products",
      isSystem: true,
    });
    const role = await RoleModel.create({
      name: "Catalog Viewer",
      grantsAll: false,
      isActive: true,
      permissions: [productPermission._id],
    });
    const userId = await createStaffUser({ roleIds: [role._id as mongoose.Types.ObjectId] });

    const resolved = await resolveStaffUser(userId.toString());

    expect(resolved).not.toBeNull();
    expect(resolved?._id).toBe(userId.toString());
    expect(resolved?.roles).toHaveLength(1);
    expect(resolved?.roles[0]?.permissions).toContain(AppPermission.PRODUCT.READ);
    expect(resolved?.roles[0]?.grantsAll).toBe(false);
  });

  it("flags a grantsAll role correctly", async () => {
    const role = await RoleModel.create({ name: "Owner", grantsAll: true, isActive: true, permissions: [] });
    const userId = await createStaffUser({ roleIds: [role._id as mongoose.Types.ObjectId] });

    const resolved = await resolveStaffUser(userId.toString());
    expect(resolved?.roles[0]?.grantsAll).toBe(true);
  });

  it("takes effect on the very next call after deactivation — no caching", async () => {
    const userId = await createStaffUser({ active: true });
    expect(await resolveStaffUser(userId.toString())).not.toBeNull();

    await StaffUserModel.updateOne({ _id: userId }, { $set: { active: false } });
    expect(await resolveStaffUser(userId.toString())).toBeNull();
  });
});
