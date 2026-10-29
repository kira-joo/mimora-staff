// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, BadRequestError } from "@kira-joo/backend-toolkit-core";
import { connectToDatabase } from "../../core/db/connect";
import { hashVerificationToken } from "../../shop/auth/hash-verification-token";
import { outboundNotifier } from "../../core/notifications";
import { StaffUserModel } from "../../identity/staff-user.schema";
import { RoleModel, PermissionModel } from "../../core/authorization/role.model";
import { listStaff } from "./list-staff";
import { inviteStaff } from "./invite-staff";
import { updateStaff } from "./update-staff";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

// Also before: these tests count every StaffUser in the shared test database,
// so they must not depend on every other suite having cleaned up after itself.
beforeEach(async () => {
  await Promise.all([StaffUserModel.deleteMany({}), RoleModel.deleteMany({}), PermissionModel.deleteMany({})]);
});

afterEach(async () => {
  await Promise.all([StaffUserModel.deleteMany({}), RoleModel.deleteMany({}), PermissionModel.deleteMany({})]);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await mongoose.disconnect();
});

async function seedRole(name = "Test Role") {
  return RoleModel.create({ name, grantsAll: false, permissions: [], isActive: true });
}

describe("listStaff", () => {
  it("lists staff with pagination and populated roles", async () => {
    const role = await seedRole("Manager");
    await StaffUserModel.create({ name: "Alice", email: "alice@example.com", roles: [role._id] });
    await StaffUserModel.create({ name: "Bob", email: "bob@example.com", roles: [] });

    const result = await listStaff({ limit: 10, page: 1 });
    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
  });

  it("searches by name or email", async () => {
    await StaffUserModel.create({ name: "Alice Wonderland", email: "alice@example.com", roles: [] });
    await StaffUserModel.create({ name: "Bob Builder", email: "bob@example.com", roles: [] });

    const result = await listStaff({ limit: 10, page: 1, search: "wonderland" });
    expect(result.total).toBe(1);
    expect(result.data[0]?.name).toBe("Alice Wonderland");
  });

  it("never exposes passwordHash", async () => {
    await StaffUserModel.create({ name: "Alice", email: "alice@example.com", roles: [] });
    const result = await listStaff({ limit: 10, page: 1 });
    expect((result.data[0] as any).passwordHash).toBeUndefined();
  });
});

describe("inviteStaff", () => {
  it("creates an account with no passwordHash, mints a reset token, and notifies by email", async () => {
    const sendSpy = vi.spyOn(outboundNotifier, "send").mockResolvedValue(undefined);

    const staff = await inviteStaff({ name: "Alice", email: "Alice@Example.com" });

    expect(staff?.email).toBe("alice@example.com");
    const stored = await StaffUserModel.findById(staff?._id)
      .select("+passwordHash +passwordResetTokenHash +passwordResetExpiresAt")
      .lean();
    expect(stored?.passwordHash).toBeUndefined();
    expect(stored?.passwordResetTokenHash).toBe(hashVerificationToken(staff.invitation.token));
    expect((staff as Record<string, unknown>).passwordResetTokenHash).toBeUndefined(); // the hash never leaves
    expect(stored?.passwordResetExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ channel: "EMAIL", to: "alice@example.com" }));
  });

  it("assigns the given roles", async () => {
    vi.spyOn(outboundNotifier, "send").mockResolvedValue(undefined);
    const role = await seedRole("Manager");

    const staff = await inviteStaff({ name: "Alice", email: "alice@example.com", roleIds: [String(role._id)] });

    expect((staff?.roles as unknown as Array<{ _id: unknown }>).map((r) => String(r._id))).toEqual([
      String(role._id),
    ]);
  });

  it("rejects a duplicate email", async () => {
    vi.spyOn(outboundNotifier, "send").mockResolvedValue(undefined);
    await StaffUserModel.create({ name: "Existing", email: "alice@example.com", roles: [] });

    await expect(inviteStaff({ name: "Alice", email: "alice@example.com" })).rejects.toThrow(ConflictError);
  });

  it("rejects a role id that does not exist", async () => {
    vi.spyOn(outboundNotifier, "send").mockResolvedValue(undefined);

    await expect(
      inviteStaff({ name: "Alice", email: "alice@example.com", roleIds: [new mongoose.Types.ObjectId().toString()] })
    ).rejects.toThrow(BadRequestError);
  });
});

describe("updateStaff", () => {
  it("updates the name without bumping tokenVersion", async () => {
    const staff = await StaffUserModel.create({ name: "Alice", email: "alice@example.com", roles: [] });

    await updateStaff({ staffId: String(staff._id), actingStaffId: "someone-else", body: { name: "Alicia" } });

    const updated = await StaffUserModel.findById(staff._id).lean();
    expect(updated?.name).toBe("Alicia");
    expect(updated?.tokenVersion).toBe(1);
  });

  it("bumps tokenVersion when roles change", async () => {
    const role = await seedRole("Manager");
    const staff = await StaffUserModel.create({ name: "Alice", email: "alice@example.com", roles: [] });

    await updateStaff({
      staffId: String(staff._id),
      actingStaffId: "someone-else",
      body: { roleIds: [String(role._id)] },
    });

    const updated = await StaffUserModel.findById(staff._id).lean();
    expect(updated?.roles.map(String)).toEqual([String(role._id)]);
    expect(updated?.tokenVersion).toBe(2);
  });

  it("bumps tokenVersion when deactivated", async () => {
    const staff = await StaffUserModel.create({ name: "Alice", email: "alice@example.com", roles: [] });

    await updateStaff({ staffId: String(staff._id), actingStaffId: "someone-else", body: { active: false } });

    const updated = await StaffUserModel.findById(staff._id).lean();
    expect(updated?.active).toBe(false);
    expect(updated?.tokenVersion).toBe(2);
  });

  it("refuses to let a staff member deactivate themselves", async () => {
    const staff = await StaffUserModel.create({ name: "Alice", email: "alice@example.com", roles: [] });

    await expect(
      updateStaff({ staffId: String(staff._id), actingStaffId: String(staff._id), body: { active: false } })
    ).rejects.toThrow(ConflictError);

    const unchanged = await StaffUserModel.findById(staff._id).lean();
    expect(unchanged?.active).toBe(true);
  });

  it("rejects a role id that does not exist", async () => {
    const staff = await StaffUserModel.create({ name: "Alice", email: "alice@example.com", roles: [] });

    await expect(
      updateStaff({
        staffId: String(staff._id),
        actingStaffId: "someone-else",
        body: { roleIds: [new mongoose.Types.ObjectId().toString()] },
      })
    ).rejects.toThrow(BadRequestError);
  });
});
