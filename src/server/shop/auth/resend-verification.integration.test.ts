// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { outboundNotifier } from "../../core/notifications";
import { CustomerModel } from "../../identity/customer.schema";
import { resendVerificationEmail } from "./resend-verification";

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

describe("resendVerificationEmail", () => {
  it("mints a fresh token for an unverified customer, replacing any outstanding one", async () => {
    const email = `customer-${Math.floor(Math.random() * 100000000)}@example.com`;
    const customer = await CustomerModel.create({
      phone: `+2010${Math.floor(Math.random() * 100000000)}`,
      email,
      passwordHash: "x",
      name: "Test Customer",
      emailVerificationTokenHash: "stale-hash-from-a-prior-send",
      emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const sendSpy = vi.spyOn(outboundNotifier, "send").mockResolvedValue(undefined);

    await resendVerificationEmail(email);

    const updated = await CustomerModel.findById(customer._id).select("+emailVerificationTokenHash +emailVerificationExpiresAt").lean();  // explicit: these fields are select: false
    expect(updated?.emailVerificationTokenHash).not.toBe("stale-hash-from-a-prior-send");
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ channel: "EMAIL", to: email }));
  });

  it("does nothing for an already-verified email — no token, no send", async () => {
    const email = `customer-${Math.floor(Math.random() * 100000000)}@example.com`;
    await CustomerModel.create({
      phone: `+2010${Math.floor(Math.random() * 100000000)}`,
      email,
      passwordHash: "x",
      name: "Test Customer",
      emailVerified: true,
    });
    const sendSpy = vi.spyOn(outboundNotifier, "send").mockResolvedValue(undefined);

    await expect(resendVerificationEmail(email)).resolves.toBeUndefined();

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("does nothing for an email matching no account", async () => {
    const sendSpy = vi.spyOn(outboundNotifier, "send").mockResolvedValue(undefined);

    await expect(resendVerificationEmail("nobody@example.com")).resolves.toBeUndefined();

    expect(sendSpy).not.toHaveBeenCalled();
  });
});
