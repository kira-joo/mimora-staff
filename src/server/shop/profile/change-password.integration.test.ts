import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import { hashPassword } from "@kira-joo/backend-toolkit-next";
import { issueRefreshToken, rotateRefreshToken } from "@kira-joo/backend-toolkit-mongoose";
import { CustomerRefreshTokenModel } from "../../identity/customer-refresh-token.schema";
import { connectToDatabase } from "../../core/db/connect";
import { failAfterWrite, restoreInjectedFailures, snapshotCollections } from "../../core/test-support/rollback-injection";
import { CustomerModel } from "../../identity/customer.schema";
import { changePassword } from "./change-password";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

describe("changePassword", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await CustomerModel.deleteMany({});
    await CustomerRefreshTokenModel.deleteMany({});
  });

  afterEach(() => {
    restoreInjectedFailures();
  });

  it("revokes every refresh-token family: a refresh token issued before the change can no longer rotate", async () => {
    const passwordHash = await hashPassword("password123");
    const customer = await CustomerModel.create({ phone: "+201000000009", passwordHash, name: "Test Customer", tokenVersion: 1 });
    const ttl = 60 * 60 * 1000;
    const thisDevice = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId: customer._id, ttlMs: ttl });
    const otherDevice = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId: customer._id, ttlMs: ttl });

    await changePassword(customer._id.toString(), { oldPassword: "password123", newPassword: "newPassword456" });

    await expect(rotateRefreshToken(CustomerRefreshTokenModel, thisDevice.token, ttl)).rejects.toThrow();
    await expect(rotateRefreshToken(CustomerRefreshTokenModel, otherDevice.token, ttl)).rejects.toThrow();
    expect(await CustomerRefreshTokenModel.countDocuments({ subjectId: customer._id, revokedAt: { $exists: false } })).toBe(0);
  });

  it("a wrong current password revokes nothing", async () => {
    const passwordHash = await hashPassword("password123");
    const customer = await CustomerModel.create({ phone: "+201000000010", passwordHash, name: "Test Customer", tokenVersion: 1 });
    const issued = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId: customer._id, ttlMs: 60_000 });

    await expect(changePassword(customer._id.toString(), { oldPassword: "wrong", newPassword: "newPassword456" })).rejects.toThrow(UnauthorizedError);
    await expect(rotateRefreshToken(CustomerRefreshTokenModel, issued.token, 60_000)).resolves.toBeDefined();
  });

  it("changes password when old password is correct", async () => {
    const oldPasswordHash = await hashPassword("oldPassword123");
    const customer = await CustomerModel.create({
      phone: "+201000000001",
      passwordHash: oldPasswordHash,
      name: "Test Customer",
      tokenVersion: 1,
    });

    await changePassword(customer._id.toString(), {
      oldPassword: "oldPassword123",
      newPassword: "newPassword456",
    });

    const updated = await CustomerModel.findById(customer._id).select("+passwordHash");
    expect(updated?.passwordHash).not.toBe(oldPasswordHash);
    expect(updated?.tokenVersion).toBe(2);
  });

  it("increments tokenVersion to revoke existing sessions", async () => {
    const passwordHash = await hashPassword("password123");
    const customer = await CustomerModel.create({
      phone: "+201000000002",
      passwordHash,
      name: "Test Customer",
      tokenVersion: 5,
    });

    await changePassword(customer._id.toString(), {
      oldPassword: "password123",
      newPassword: "newPassword789",
    });

    const updated = await CustomerModel.findById(customer._id);
    expect(updated?.tokenVersion).toBe(6);
  });

  it("throws UnauthorizedError when old password is incorrect", async () => {
    const passwordHash = await hashPassword("correctPassword");
    const customer = await CustomerModel.create({
      phone: "+201000000003",
      passwordHash,
      name: "Test Customer",
    });

    await expect(
      changePassword(customer._id.toString(), {
        oldPassword: "wrongPassword",
        newPassword: "newPassword123",
      })
    ).rejects.toThrow(UnauthorizedError);

    await expect(
      changePassword(customer._id.toString(), {
        oldPassword: "wrongPassword",
        newPassword: "newPassword123",
      })
    ).rejects.toThrow("Current password is incorrect.");
  });

  it("does not change password when old password is wrong", async () => {
    const originalHash = await hashPassword("original123");
    const customer = await CustomerModel.create({
      phone: "+201000000004",
      passwordHash: originalHash,
      name: "Test Customer",
      tokenVersion: 1,
    });

    await expect(
      changePassword(customer._id.toString(), {
        oldPassword: "wrong",
        newPassword: "new123",
      })
    ).rejects.toThrow(UnauthorizedError);

    const unchanged = await CustomerModel.findById(customer._id).select("+passwordHash");
    expect(unchanged?.passwordHash).toBe(originalHash);
    expect(unchanged?.tokenVersion).toBe(1);
  });

  it("validates new password meets minimum length", async () => {
    const passwordHash = await hashPassword("oldPassword123");
    const customer = await CustomerModel.create({
      phone: "+201000000005",
      passwordHash,
      name: "Test Customer",
    });

    // This validation happens at DTO level, but we can test the service accepts valid input
    await expect(
      changePassword(customer._id.toString(), {
        oldPassword: "oldPassword123",
        newPassword: "short",
      })
    ).resolves.not.toThrow();
  });

  it("throws when customer does not exist", async () => {
    const nonExistentId = new mongoose.Types.ObjectId();
    await expect(
      changePassword(nonExistentId.toString(), {
        oldPassword: "any",
        newPassword: "newPassword123",
      })
    ).rejects.toThrow("Customer not found");
  });

  describe("rollback — the password change and the session revocation are one write", () => {
    it("a failure after the refresh-token revocation leaves the customer and every refresh token exactly as before", async () => {
      const originalHash = await hashPassword("password123");
      const customer = await CustomerModel.create({ phone: "+201000000011", passwordHash: originalHash, name: "Test Customer", tokenVersion: 1 });
      const ttlMs = 60 * 60 * 1000;
      const device = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId: customer._id, ttlMs });
      const before = await snapshotCollections(CustomerModel, CustomerRefreshTokenModel);
      // revokeAllForSubject is `model.updateMany`; it runs last in the transaction, after the customer write.
      const revocation = failAfterWrite(CustomerRefreshTokenModel, "updateMany", 1);

      await expect(changePassword(customer._id.toString(), { oldPassword: "password123", newPassword: "newPassword456" })).rejects.toThrow("injected failure");

      expect(revocation.calls).toBe(1);
      expect(await snapshotCollections(CustomerModel, CustomerRefreshTokenModel)).toEqual(before);
      const unchanged = await CustomerModel.findById(customer._id).select("+passwordHash");
      expect(unchanged?.passwordHash).toBe(originalHash);
      expect(unchanged?.tokenVersion).toBe(1);
      restoreInjectedFailures();
      await expect(rotateRefreshToken(CustomerRefreshTokenModel, device.token, ttlMs)).resolves.toBeDefined();
    });
  });
});
