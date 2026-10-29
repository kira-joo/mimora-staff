// @vitest-environment node
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "../db/connect";
import { ActivityLogModel } from "../activity-log.schema";
import { recordActivity } from "./record-activity";
import { activityLogRepository } from "../repositories";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await ActivityLogModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

function fakeRequest(): NextRequest {
  return new NextRequest("https://staff.example.com/api/admin/products/1", {
    headers: { "x-forwarded-for": "203.0.113.4, 10.0.0.1" },
  });
}

describe("recordActivity", () => {
  it("derives entityType/action from the permission key, never from a separately-typed value", async () => {
    const actorId = new mongoose.Types.ObjectId();
    await recordActivity({
      permissionKey: "Product.delete",
      user: { _id: actorId.toString(), name: "Staff Member" },
      params: { id: new mongoose.Types.ObjectId().toString() },
      request: fakeRequest(),
    });

    const entries = await ActivityLogModel.find({ actorId }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entityType).toBe("Product");
    expect(entries[0]?.action).toBe("delete");
  });

  it("works for a CustomPermission action key too, e.g. Payment.verify", async () => {
    const actorId = new mongoose.Types.ObjectId();
    await recordActivity({ permissionKey: "Payment.verify", user: { _id: actorId.toString() }, request: fakeRequest() });

    const entries = await ActivityLogModel.find({ actorId }).lean();
    expect(entries[0]?.entityType).toBe("Payment");
    expect(entries[0]?.action).toBe("verify");
  });

  it("redacts sensitive fields in the recorded body, recursively", async () => {
    const actorId = new mongoose.Types.ObjectId();
    await recordActivity({
      permissionKey: "StaffUser.update",
      user: { _id: actorId.toString() },
      body: { name: "New Name", passwordHash: "should-not-be-stored", nested: { refreshToken: "should-not-be-stored-either" } },
      request: fakeRequest(),
    });

    const entry = await ActivityLogModel.findOne({ actorId }).lean();
    expect(entry?.changes).toMatchObject({
      name: "New Name",
      passwordHash: "[redacted]",
      nested: { refreshToken: "[redacted]" },
    });
  });

  describe("client IP — the shared resolveClientIp trust model", () => {
    const originalHops = process.env.CLIENT_IP_TRUSTED_HOPS;
    const originalRealIp = process.env.TRUST_X_REAL_IP;
    afterEach(() => {
      if (originalHops === undefined) delete process.env.CLIENT_IP_TRUSTED_HOPS;
      else process.env.CLIENT_IP_TRUSTED_HOPS = originalHops;
      if (originalRealIp === undefined) delete process.env.TRUST_X_REAL_IP;
      else process.env.TRUST_X_REAL_IP = originalRealIp;
    });

    const ipFor = async (headers: Record<string, string>) => {
      const actorId = new mongoose.Types.ObjectId();
      await recordActivity({ permissionKey: "Product.delete", user: { _id: actorId.toString() }, request: new NextRequest("https://staff.example.com/api/admin/products/1", { headers }) });
      return (await ActivityLogModel.findOne({ actorId }).lean())?.ipAddress;
    };

    it("by default records the RIGHT-most entry (what the nearest trusted proxy appended), never a client-supplied first entry", async () => {
      delete process.env.CLIENT_IP_TRUSTED_HOPS;
      expect(await ipFor({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })).toBe("203.0.113.9");
    });

    it("honours CLIENT_IP_TRUSTED_HOPS: with two trusted proxies the client is the second from the right", async () => {
      process.env.CLIENT_IP_TRUSTED_HOPS = "2";
      expect(await ipFor({ "x-forwarded-for": "6.6.6.6, 203.0.113.4, 10.0.0.1" })).toBe("203.0.113.4");
    });

    it("believes x-real-ip only when TRUST_X_REAL_IP=1", async () => {
      delete process.env.TRUST_X_REAL_IP;
      expect(await ipFor({ "x-real-ip": "198.51.100.7" })).toBeUndefined();
      process.env.TRUST_X_REAL_IP = "1";
      expect(await ipFor({ "x-real-ip": "198.51.100.7" })).toBe("198.51.100.7");
    });

    it("stores no address at all when no usable header exists (never the string \"unknown\")", async () => {
      expect(await ipFor({})).toBeUndefined();
    });
  });

  it("never throws even if the write fails — a broken audit trail must not break the mutation it audits", async () => {
    const saveSpy = vi.spyOn(activityLogRepository, "save").mockRejectedValueOnce(new Error("simulated DB failure"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      recordActivity({ permissionKey: "Product.delete", user: { _id: new mongoose.Types.ObjectId().toString() }, request: fakeRequest() })
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled(); // loud, not silent — logged at error level
    saveSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("does not record an entry with no resolvable actor, and logs loudly instead", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = await ActivityLogModel.countDocuments({});

    await recordActivity({ permissionKey: "Product.delete", user: null, request: fakeRequest() });

    expect(await ActivityLogModel.countDocuments({})).toBe(before); // no entry attributed to nobody
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
