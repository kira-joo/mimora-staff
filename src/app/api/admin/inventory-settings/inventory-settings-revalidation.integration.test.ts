import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { InventorySettingsModel } from "src/server/fulfilment/inventory-settings.schema";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * Plan #91 — the low-stock threshold feeds the storefront's "few left" signal
 * (listing cards and the product page, both cached under PRODUCTS), so saving
 * it must invalidate PRODUCTS exactly once, and a refused save must not.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const route = await import("./route");
const PUT = route.PUT as RouteHandler;
const PATH = "/api/admin/inventory-settings";

const revalidations: Array<{ tags: string[] }> = [];
const realFetch = globalThis.fetch;
let owner: AdminCaller;

beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await Promise.all([removeHarnessStaff(), InventorySettingsModel.deleteMany({})]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await InventorySettingsModel.deleteMany({});
  revalidations.length = 0;
  process.env.STOREFRONT_REVALIDATE_URL = "http://storefront.test/api/revalidate";
  process.env.REVALIDATE_SECRET = "test-revalidate-secret";
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("http://storefront.test/")) {
      revalidations.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200 });
    }
    return realFetch(url, init);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STOREFRONT_REVALIDATE_URL;
  delete process.env.REVALIDATE_SECRET;
});

describe("PUT /api/admin/inventory-settings — cache invalidation", () => {
  it("a successful save invalidates PRODUCTS exactly once", async () => {
    const response = await owner.call(PUT, PATH, { method: "PUT", body: { lowStockThreshold: 9 } });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(revalidations).toHaveLength(1));
    expect(revalidations[0]?.tags).toEqual(["PRODUCTS"]);
  });

  it("a refused save (invalid body) invalidates nothing", async () => {
    const response = await owner.call(PUT, PATH, { method: "PUT", body: { lowStockThreshold: -3 } });
    expect(response.status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(revalidations).toEqual([]);
  });

  it("a save without the update permission is 403 and invalidates nothing", async () => {
    const reader = await signInWithPermissions([AppPermission.INVENTORY_SETTINGS.READ]);
    const response = await reader.call(PUT, PATH, { method: "PUT", body: { lowStockThreshold: 9 } });
    expect(response.status).toBe(403);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(revalidations).toEqual([]);
    expect(await InventorySettingsModel.countDocuments({})).toBe(0);
  });
});
