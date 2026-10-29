// @vitest-environment node
import { comparePassword, hashPassword } from "@kira-joo/backend-toolkit-next";
import { issueRefreshToken, rotateRefreshToken } from "@kira-joo/backend-toolkit-mongoose";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { failAfterWrite, restoreInjectedFailures, snapshotCollections } from "../../core/test-support/rollback-injection";
import { CustomerModel } from "../../identity/customer.schema";
import { CustomerRefreshTokenModel } from "../../identity/customer-refresh-token.schema";
import { hashVerificationToken } from "./hash-verification-token";
import { resetPassword } from "./reset-password";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  restoreInjectedFailures();
  await CustomerModel.deleteMany({});
  await CustomerRefreshTokenModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

async function createCustomerWithResetToken(overrides: { expired?: boolean } = {}) {
  const token = randomBytes(32).toString("base64url");
  const customer = await CustomerModel.create({
    phone: `+2010${Math.floor(Math.random() * 100000000)}`,
    passwordHash: await hashPassword("original-password"),
    name: "Test Customer",
    passwordResetTokenHash: hashVerificationToken(token),
    passwordResetExpiresAt: new Date(Date.now() + (overrides.expired ? -1000 : 60 * 60 * 1000)),
  });
  return { customer, token };
}

describe("resetPassword", () => {
  it("sets the new password, clears the token, and bumps tokenVersion", async () => {
    const { customer, token } = await createCustomerWithResetToken();

    await resetPassword(token, "brand-new-password");

    const updated = await CustomerModel.findById(customer._id).select("+passwordHash +passwordResetTokenHash +passwordResetExpiresAt").lean();  // explicit: these fields are select: false
    expect(await comparePassword("brand-new-password", updated!.passwordHash)).toBe(true);
    expect(updated?.passwordResetTokenHash).toBeUndefined();
    expect(updated?.passwordResetExpiresAt).toBeUndefined();
    expect(updated?.tokenVersion).toBe(2);
  });

  it("revokes every existing refresh token for the customer — every device signs out", async () => {
    const { customer, token } = await createCustomerWithResetToken();
    const sessionA = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId: customer._id, ttlMs: 60 * 60 * 1000 });
    const sessionB = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId: customer._id, ttlMs: 60 * 60 * 1000 });

    await resetPassword(token, "brand-new-password");

    await expect(rotateRefreshToken(CustomerRefreshTokenModel, sessionA.token, 60 * 60 * 1000)).rejects.toThrow();
    await expect(rotateRefreshToken(CustomerRefreshTokenModel, sessionB.token, 60 * 60 * 1000)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const { token } = await createCustomerWithResetToken({ expired: true });
    await expect(resetPassword(token, "brand-new-password")).rejects.toThrow(/invalid or has expired/);
  });

  it("rejects an unknown token", async () => {
    await expect(resetPassword("not-a-real-token", "brand-new-password")).rejects.toThrow(/invalid or has expired/);
  });

  it("is single-use — the same token cannot reset a second time", async () => {
    const { token } = await createCustomerWithResetToken();

    await resetPassword(token, "brand-new-password");

    await expect(resetPassword(token, "yet-another-password")).rejects.toThrow(/invalid or has expired/);
  });
});

describe("resetPassword rollback — the password change and the session revocation are one write", () => {
  it("a failure after the refresh-token revocation leaves the customer and every refresh token exactly as before", async () => {
    const { customer, token } = await createCustomerWithResetToken();
    const ttlMs = 60 * 60 * 1000;
    const device = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId: customer._id, ttlMs });
    const before = await snapshotCollections(CustomerModel, CustomerRefreshTokenModel);
    // revokeAllForSubject is `model.updateMany`; it runs last in the transaction, after the customer write.
    const revocation = failAfterWrite(CustomerRefreshTokenModel, "updateMany", 1);

    await expect(resetPassword(token, "brand-new-password")).rejects.toThrow("injected failure");

    expect(revocation.calls).toBe(1);
    expect(await snapshotCollections(CustomerModel, CustomerRefreshTokenModel)).toEqual(before);
    // The visible consequences: the old password still works, the reset link is still usable, the session still rotates.
    const unchanged = await CustomerModel.findById(customer._id).select("+passwordHash +passwordResetTokenHash").lean();
    expect(await comparePassword("original-password", unchanged!.passwordHash)).toBe(true);
    expect(unchanged?.passwordResetTokenHash).toBe(hashVerificationToken(token));
    expect(unchanged?.tokenVersion).toBe(1);
    restoreInjectedFailures();
    await expect(rotateRefreshToken(CustomerRefreshTokenModel, device.token, ttlMs)).resolves.toBeDefined();
  });
});
