// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { connectToDatabase } from "../../core/db/connect";
import { StaffUserModel } from "../../identity/staff-user.schema";
import { StaffOwnerLockModel } from "../../identity/staff-owner-lock.schema";
import { roleRepository } from "../../core/repositories";
import { RoleModel, PermissionModel } from "../../core/authorization/role.model";
import { assertRoleEditKeepsAnOwner, withOwnerGuard } from "./owner-invariant";

/**
 * Role edits and the Owner invariant. There is no role-edit ROUTE today (see `assertRoleEditKeepsAnOwner`), so these
 * tests drive the guard exactly as a future route must: inside `withOwnerGuard`, before the write.
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

const role = (name: string, grantsAll: boolean, isActive = true) => RoleModel.create({ name, grantsAll, permissions: [], isActive });
const staff = (name: string, roles: mongoose.Types.ObjectId[], active = true) => StaffUserModel.create({ name, email: `${name}-${new mongoose.Types.ObjectId()}@example.com`, roles, active });
const id = (document: { _id: mongoose.Types.ObjectId }) => document._id.toString();
const guarded = (roleId: string, patch: { grantsAll?: boolean; isActive?: boolean }) => withOwnerGuard(() => assertRoleEditKeepsAnOwner(roleId, patch));

describe("assertRoleEditKeepsAnOwner", () => {
  it("NEGATIVE: the default Owner role can never lose grantsAll — even with a second Owner role present", async () => {
    const owner = await role("Owner", true);
    const spare = await role("Spare owners", true);
    await staff("a", [owner._id]);
    await staff("b", [spare._id]);

    await expect(guarded(id(owner), { grantsAll: false })).rejects.toThrow(ConflictError);
    await expect(guarded(id(owner), { grantsAll: false })).rejects.toThrow(/always grants full access/);
    await expect(guarded(id(owner), { isActive: false })).rejects.toThrow(/always grants full access/);
  });

  it("NEGATIVE: a custom full-access role cannot be switched off while its holders are the last Owners", async () => {
    const custom = await role("Custom owners", true);
    await staff("a", [custom._id]);
    await staff("b", [custom._id]);

    await expect(guarded(id(custom), { grantsAll: false })).rejects.toThrow(/last active Owner/);
    await expect(guarded(id(custom), { isActive: false })).rejects.toThrow(/last active Owner/);
  });

  it("allows switching a full-access role off when active staff hold ANOTHER active full-access role", async () => {
    const custom = await role("Custom owners", true);
    const owner = await role("Owner", true);
    await staff("a", [custom._id]);
    await staff("b", [owner._id]);

    await expect(guarded(id(custom), { grantsAll: false })).resolves.toBeUndefined();
  });

  it("an INACTIVE staff member holding the other full-access role does not count", async () => {
    const custom = await role("Custom owners", true);
    const owner = await role("Owner", true);
    await staff("a", [custom._id]);
    await staff("dormant", [owner._id], false);

    await expect(guarded(id(custom), { grantsAll: false })).rejects.toThrow(/last active Owner/);
  });

  it("edits that do not touch grantsAll/isActive are always allowed, and so is editing a role nobody holds", async () => {
    const owner = await role("Owner", true);
    const plain = await role("Plain", false);
    await staff("a", [owner._id]);

    await expect(guarded(id(owner), {})).resolves.toBeUndefined();
    await expect(guarded(id(plain), { isActive: false })).resolves.toBeUndefined();
    await expect(guarded(id(plain), { grantsAll: true })).resolves.toBeUndefined();
  });
});

describe("withOwnerGuard rollback — the lock bump and the guarded write are one transaction", () => {
  const lock = () => StaffOwnerLockModel.collection.find({}).sort({ _id: 1 }).toArray();
  const wipeLock = () => StaffOwnerLockModel.deleteMany({});
  beforeEach(wipeLock); // earlier tests in this file leave the lock document behind
  afterEach(wipeLock);

  it("when the guarded work fails after its own write, neither the work's write nor the owner-lock increment survives", async () => {
    await StaffOwnerLockModel.create({ key: "staff-owners", version: 3 });
    const plain = await role("Plain", false);
    const lockBefore = await lock();
    const roleBefore = await RoleModel.collection.findOne({ _id: plain._id });

    await expect(
      withOwnerGuard(async () => {
        await roleRepository.updateAtomic({ _id: plain._id }, { $set: { isActive: false } }); // a real write inside the guard
        throw new ConflictError("a later step refused");
      })
    ).rejects.toThrow("a later step refused");

    expect(await lock()).toEqual(lockBefore); // version is still 3
    expect(await RoleModel.collection.findOne({ _id: plain._id })).toEqual(roleBefore);
  });

  it("the first guarded call that fails leaves no lock document behind (the upsert is rolled back too)", async () => {
    expect(await lock()).toEqual([]);
    await expect(withOwnerGuard(async () => { throw new ConflictError("refused"); })).rejects.toThrow("refused");
    expect(await lock()).toEqual([]);
  });

  it("a guarded call that succeeds does bump the lock — the increment these tests compare against is real", async () => {
    await StaffOwnerLockModel.create({ key: "staff-owners", version: 3 });
    await withOwnerGuard(async () => undefined);
    expect((await lock())[0]).toMatchObject({ key: "staff-owners", version: 4 });
  });
});
