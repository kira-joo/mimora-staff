// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { outboundNotifier } from "../../core/notifications";
import { CustomerModel } from "../../identity/customer.schema";
import { requestPasswordReset } from "./forgot-password";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await CustomerModel.deleteMany({});
  vi.restoreAllMocks();
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("requestPasswordReset", () => {
  it("mints and stores a reset token, and notifies the customer's email when they have one", async () => {
    const email = `customer-${Math.floor(Math.random() * 100000000)}@example.com`;
    const customer = await CustomerModel.create({
      phone: `+2010${Math.floor(Math.random() * 100000000)}`,
      email,
      passwordHash: "x",
      name: "Test Customer",
    });
    const sendSpy = vi.spyOn(outboundNotifier, "send").mockResolvedValue(undefined);

    await requestPasswordReset(email);

    const updated = await CustomerModel.findById(customer._id).select("+passwordResetTokenHash +passwordResetExpiresAt").lean();  // explicit: these fields are select: false
    expect(updated?.passwordResetTokenHash).toBeTruthy();
    expect(updated?.passwordResetExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ channel: "EMAIL", to: email }));
  });

  it("falls back to SMS when the customer has no email on file", async () => {
    const phone = `+2010${Math.floor(Math.random() * 100000000)}`;
    await CustomerModel.create({ phone, passwordHash: "x", name: "Test Customer" });
    const sendSpy = vi.spyOn(outboundNotifier, "send").mockResolvedValue(undefined);

    await requestPasswordReset(phone);

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ channel: "SMS", to: phone }));
  });

  it("resolves identically — no notification, no throw — for an identifier that matches nobody", async () => {
    const sendSpy = vi.spyOn(outboundNotifier, "send").mockResolvedValue(undefined);

    await expect(requestPasswordReset("+201000000000")).resolves.toBeUndefined();

    expect(sendSpy).not.toHaveBeenCalled();
  });
});
