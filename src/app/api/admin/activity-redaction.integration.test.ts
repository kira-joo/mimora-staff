import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { ActivityLogModel } from "src/server/core/activity-log.schema";
import { FulfilmentSettingsModel } from "src/server/fulfilment/fulfilment-settings.schema";
import { StoreProfileModel } from "src/server/content/store-profile.schema";
import { removeHarnessStaff, signInAsOwner, type AdminCaller, type RouteHandler } from "./test-support/admin-route-harness";

/**
 * Route-level: the audit log records what an admin actually changed. The old
 * substring rule hid the shipping settings ("shi-PIN-g") and the theme's
 * public colour overrides ("TOKEN-Overrides") as "[redacted]".
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("./test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const putFulfilment = (await import("./fulfilment-settings/route")).PUT as RouteHandler;
const putTheme = (await import("./store-profile/theme/route")).PUT as RouteHandler;

let admin: AdminCaller;

async function lastEntry(entityType: string) {
  return ActivityLogModel.findOne({ entityType }).sort({ _id: -1 }).lean();
}

beforeAll(async () => {
  await connectToDatabase();
  admin = await signInAsOwner();
});

afterAll(async () => {
  await Promise.all([removeHarnessStaff(), ActivityLogModel.deleteMany({}), FulfilmentSettingsModel.deleteMany({}), StoreProfileModel.deleteMany({})]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([ActivityLogModel.deleteMany({}), FulfilmentSettingsModel.deleteMany({}), StoreProfileModel.deleteMany({})]);
});

describe("the audit log records non-secret fields as sent", () => {
  it("fulfilment settings keep shippingFeeMode and flatShippingFee", async () => {
    const response = await admin.call(putFulfilment, "/api/admin/fulfilment-settings", { method: "PUT", body: { shippingFeeMode: "FLAT", flatShippingFee: "40.00" } });
    expect(response.status).toBe(200);
    const entry = await lastEntry("FulfilmentSettings");
    expect(entry?.changes).toMatchObject({ shippingFeeMode: "FLAT", flatShippingFee: "40.00" });
    expect(JSON.stringify(entry?.changes)).not.toContain("[redacted]");
  });

  it("the theme keeps its tokenOverrides — public brand colours, served by GET /api/storefront/theme", async () => {
    const body = {
      brand: { primary: "#6B8F71", accent: "#C0392B", surface: "#FFFFFF", text: "#111111", radiusScale: 1, typographyChoice: "default" },
      theme: { defaultGround: "light", darkEnabled: false, allowVisitorChoice: false, tokenOverrides: [{ key: "accent", value: "#AA3322" }] },
    };
    const response = await admin.call(putTheme, "/api/admin/store-profile/theme", { method: "PUT", body });
    expect(response.status).toBe(200);
    const entry = await lastEntry("StoreProfile");
    expect((entry?.changes as typeof body | undefined)?.theme.tokenOverrides).toEqual([{ key: "accent", value: "#AA3322" }]);
  });
});
