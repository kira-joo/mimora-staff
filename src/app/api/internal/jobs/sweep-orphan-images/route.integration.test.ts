import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { PendingUploadModel } from "src/server/catalog/pending-upload.schema";
import type { RouteHandler } from "../../../admin/test-support/admin-route-harness";

/**
 * The scheduler's entry point, with the same guard as `expire-unpaid-orders`: `auth: false` plus the shared secret.
 * The negative cases are the point — no secret configured, none presented, a wrong one: each is a 404 and destroys
 * NOTHING.
 */
const provider = vi.hoisted(() => ({
  destroyed: [] as string[],
  destroyAsset: async (publicId: string) => {
    provider.destroyed.push(publicId);
  },
}));
vi.mock("src/server/core/assets/asset-providers", () => ({ assetProvider: () => provider }));

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const routes = await import("./route");
const post = routes.POST as RouteHandler;
const get = routes.GET as RouteHandler;
const SECRET = "integration-test-jobs-secret-0123456789";
const originalSecret = process.env.JOBS_SECRET;
const originalCronSecret = process.env.CRON_SECRET;

const request = (method: "GET" | "POST", headers: Record<string, string> = {}) => new NextRequest("http://localhost/api/internal/jobs/sweep-orphan-images", { method, headers });
const context = { params: Promise.resolve({}) };
const seedOrphan = () => PendingUploadModel.collection.insertOne({ publicId: "store/products/orphan", createdAt: new Date(Date.now() - 48 * 3_600_000), updatedAt: new Date() });

beforeAll(connectToDatabase);
afterAll(async () => {
  await PendingUploadModel.deleteMany({});
  await mongoose.disconnect();
});
beforeEach(async () => {
  provider.destroyed.length = 0;
  await PendingUploadModel.deleteMany({});
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env.JOBS_SECRET;
  else process.env.JOBS_SECRET = originalSecret;
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
});

describe("/api/internal/jobs/sweep-orphan-images", () => {
  it("POST with the secret destroys an old orphan and answers the result", async () => {
    process.env.JOBS_SECRET = SECRET;
    await seedOrphan();

    const response = await post(request("POST", { "x-jobs-secret": SECRET }), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ examined: 1, kept: 0, destroyed: ["store/products/orphan"], failed: [] });
    expect(provider.destroyed).toEqual(["store/products/orphan"]);
  });

  it("Vercel Cron: GET with Authorization: Bearer $CRON_SECRET (and no JOBS_SECRET) sweeps too", async () => {
    delete process.env.JOBS_SECRET;
    process.env.CRON_SECRET = SECRET;
    await seedOrphan();

    const response = await get(request("GET", { authorization: `Bearer ${SECRET}` }), context);

    expect(response.status).toBe(200);
    expect(provider.destroyed).toEqual(["store/products/orphan"]);
  });

  it.each([
    ["no credential", {}],
    ["a wrong secret", { "x-jobs-secret": "wrong" }],
    ["a wrong bearer token", { authorization: "Bearer wrong" }],
  ])("NEGATIVE: %s is a 404 for POST and GET and destroys nothing", async (_label, headers) => {
    process.env.JOBS_SECRET = SECRET;
    await seedOrphan();

    expect((await post(request("POST", headers), context)).status).toBe(404);
    expect((await get(request("GET", headers), context)).status).toBe(404);

    expect(provider.destroyed).toEqual([]);
    expect(await PendingUploadModel.countDocuments()).toBe(1);
  });

  it("NEGATIVE: with neither secret configured EVERY caller gets a 404", async () => {
    delete process.env.JOBS_SECRET;
    delete process.env.CRON_SECRET;
    await seedOrphan();

    const attempts: Record<string, string>[] = [{}, { authorization: "Bearer " }, { authorization: `Bearer ${SECRET}` }, { "x-jobs-secret": "" }];
    for (const headers of attempts) {
      expect((await post(request("POST", headers), context)).status).toBe(404);
    }
    expect(provider.destroyed).toEqual([]);
  });
});
