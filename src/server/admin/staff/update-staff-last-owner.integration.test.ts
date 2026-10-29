// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { connectToDatabase } from "../../core/db/connect";
import { StaffUserModel } from "../../identity/staff-user.schema";
import { RoleModel, PermissionModel } from "../../core/authorization/role.model";
import { updateStaff } from "./update-staff";

/**
 * The last active Owner can be neither demoted nor deactivated — including by
 * themselves. An "Owner" is active AND holds an active `grantsAll` role.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const wipe = () => Promise.all([StaffUserModel.deleteMany({}), RoleModel.deleteMany({}), PermissionModel.deleteMany({})]);
beforeAll(connectToDatabase);
beforeEach(wipe);
afterEach(wipe);
afterAll(async () => {
  await mongoose.disconnect();
});

const ownerRole = () => RoleModel.create({ name: `Owner-${new mongoose.Types.ObjectId()}`, grantsAll: true, permissions: [], isActive: true });
const plainRole = () => RoleModel.create({ name: `Plain-${new mongoose.Types.ObjectId()}`, grantsAll: false, permissions: [], isActive: true });
const staff = (name: string, roles: mongoose.Types.ObjectId[], active = true) => StaffUserModel.create({ name, email: `${name}-${new mongoose.Types.ObjectId()}@example.com`, roles, active });
const id = (document: { _id: mongoose.Types.ObjectId }) => document._id.toString();

describe("updateStaff — the last active Owner", () => {
  it("refuses to deactivate the sole Owner, by another administrator", async () => {
    const owner = await ownerRole();
    const sole = await staff("sole", [owner._id]);
    const admin = await staff("admin", [(await plainRole())._id]);

    await expect(updateStaff({ staffId: id(sole), actingStaffId: id(admin), body: { active: false } })).rejects.toThrow(ConflictError);
    await expect(updateStaff({ staffId: id(sole), actingStaffId: id(admin), body: { active: false } })).rejects.toThrow(/last active Owner/);

    const after = await StaffUserModel.findById(sole._id).lean();
    expect(after?.active).toBe(true);
    expect(after?.tokenVersion).toBe(sole.tokenVersion); // a refused change must not sign anyone out
  });

  it("refuses self-demotion of the sole Owner (dropping the Owner role)", async () => {
    const owner = await ownerRole();
    const plain = await plainRole();
    const sole = await staff("sole", [owner._id]);

    await expect(updateStaff({ staffId: id(sole), actingStaffId: id(sole), body: { roleIds: [id(plain)] } })).rejects.toThrow(/last active Owner/);
    await expect(updateStaff({ staffId: id(sole), actingStaffId: id(sole), body: { roleIds: [] } })).rejects.toThrow(/last active Owner/);

    expect((await StaffUserModel.findById(sole._id).lean())?.roles.map(String)).toEqual([id(owner)]);
  });

  it("allows what does not remove the last Owner: a rename, or a role change that keeps an Owner role", async () => {
    const owner = await ownerRole();
    const otherOwner = await ownerRole();
    const sole = await staff("sole", [owner._id]);

    await updateStaff({ staffId: id(sole), actingStaffId: id(sole), body: { name: "Renamed" } });
    await updateStaff({ staffId: id(sole), actingStaffId: id(sole), body: { roleIds: [id(otherOwner)] } });

    const after = await StaffUserModel.findById(sole._id).lean();
    expect(after?.name).toBe("Renamed");
    expect(after?.roles.map(String)).toEqual([id(otherOwner)]);
  });

  it("allows demoting an Owner while another active Owner remains — and then refuses to demote that one", async () => {
    const owner = await ownerRole();
    const plain = await plainRole();
    const first = await staff("first", [owner._id]);
    const second = await staff("second", [owner._id]);

    await updateStaff({ staffId: id(first), actingStaffId: id(second), body: { roleIds: [id(plain)] } });
    expect((await StaffUserModel.findById(first._id).lean())?.roles.map(String)).toEqual([id(plain)]);

    await expect(updateStaff({ staffId: id(second), actingStaffId: id(first), body: { roleIds: [id(plain)] } })).rejects.toThrow(/last active Owner/);
    await expect(updateStaff({ staffId: id(second), actingStaffId: id(first), body: { active: false } })).rejects.toThrow(/last active Owner/);
  });

  it("an inactive Owner does not count as another Owner", async () => {
    const owner = await ownerRole();
    const plain = await plainRole();
    const active = await staff("active", [owner._id]);
    await staff("inactive", [owner._id], false);

    await expect(updateStaff({ staffId: id(active), actingStaffId: id(active), body: { roleIds: [id(plain)] } })).rejects.toThrow(/last active Owner/);
  });

  it("a holder of an INACTIVE full-access role is not an Owner, so does not count", async () => {
    const owner = await ownerRole();
    const dormant = await RoleModel.create({ name: `Dormant-${new mongoose.Types.ObjectId()}`, grantsAll: true, permissions: [], isActive: false });
    const plain = await plainRole();
    const active = await staff("active", [owner._id]);
    await staff("dormant-holder", [dormant._id]);

    await expect(updateStaff({ staffId: id(active), actingStaffId: id(active), body: { roleIds: [id(plain)] } })).rejects.toThrow(/last active Owner/);
  });

  it("is not triggered for staff who are not Owners", async () => {
    const owner = await ownerRole();
    const plain = await plainRole();
    await staff("owner", [owner._id]);
    const clerk = await staff("clerk", [plain._id]);

    await updateStaff({ staffId: id(clerk), actingStaffId: "someone-else", body: { active: false } });
    expect((await StaffUserModel.findById(clerk._id).lean())?.active).toBe(false);
  });

  it("self-deactivation is still refused with its own message", async () => {
    const owner = await ownerRole();
    const one = await staff("one", [owner._id]);
    await staff("two", [owner._id]);
    await expect(updateStaff({ staffId: id(one), actingStaffId: id(one), body: { active: false } })).rejects.toThrow(/cannot deactivate your own account/);
  });
});

/**
 * The check is a read followed by a write, so without serialisation two Owners demoting each other in the same instant
 * both read "the other one is still an Owner" and both succeed — write skew, zero Owners. `withOwnerGuard` makes them
 * write-conflict on a shared lock document; the loser re-counts after the winner commits and is refused.
 */
describe("updateStaff — concurrent demotion of the last two Owners", () => {
  const activeOwners = async (ownerRoleId: mongoose.Types.ObjectId) => StaffUserModel.countDocuments({ active: true, roles: ownerRoleId });
  const ROUNDS = 12;

  it("two Owners demoting EACH OTHER at once: exactly one succeeds, one Owner always remains", async () => {
    const owner = await ownerRole();
    const plain = await plainRole();
    for (let round = 0; round < ROUNDS; round += 1) {
      await StaffUserModel.deleteMany({});
      const first = await staff("first", [owner._id]);
      const second = await staff("second", [owner._id]);

      const settled = await Promise.allSettled([
        updateStaff({ staffId: id(first), actingStaffId: id(second), body: { roleIds: [id(plain)] } }),
        updateStaff({ staffId: id(second), actingStaffId: id(first), body: { roleIds: [id(plain)] } }),
      ]);

      expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const refused = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(refused?.reason).toBeInstanceOf(ConflictError);
      expect(refused?.reason.message).toMatch(/last active Owner/);
      expect(await activeOwners(owner._id)).toBe(1);
    }
  });

  it("two administrators deactivating the two Owners at once: at least one stays active", async () => {
    const owner = await ownerRole();
    for (let round = 0; round < ROUNDS; round += 1) {
      await StaffUserModel.deleteMany({});
      const first = await staff("first", [owner._id]);
      const second = await staff("second", [owner._id]);
      const admin = await staff("admin", [(await plainRole())._id]);

      const settled = await Promise.allSettled([
        updateStaff({ staffId: id(first), actingStaffId: id(admin), body: { active: false } }),
        updateStaff({ staffId: id(second), actingStaffId: id(admin), body: { active: false } }),
      ]);

      expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await activeOwners(owner._id)).toBe(1);
    }
  });

  it("with THREE Owners, two concurrent demotions both succeed — the guard serialises, it does not over-refuse", async () => {
    const owner = await ownerRole();
    const plain = await plainRole();
    const first = await staff("first", [owner._id]);
    const second = await staff("second", [owner._id]);
    const third = await staff("third", [owner._id]);

    const settled = await Promise.allSettled([
      updateStaff({ staffId: id(first), actingStaffId: id(third), body: { roleIds: [id(plain)] } }),
      updateStaff({ staffId: id(second), actingStaffId: id(third), body: { roleIds: [id(plain)] } }),
    ]);

    expect(settled.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await activeOwners(owner._id)).toBe(1);
  });
});
