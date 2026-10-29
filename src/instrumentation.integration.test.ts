// @vitest-environment node
import { syncPermissions } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMISSION_DEFINITIONS } from "./common/authorization/authorization-registry";
import { connectToDatabase } from "./server/core/db/connect";
import { PermissionModel } from "./server/core/authorization/role.model";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await PermissionModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

/**
 * Exercises the exact boot-time sequence `instrumentation.ts` runs —
 * confirms the two-tier permission vocabulary (generated CRUD entries for
 * every Phase 4A.5 entity, plus the hand-declared `CustomPermission`
 * entries) syncs into the real `Permission` collection with no key
 * collisions, no duplicate-key errors, and a stable rerun.
 */
describe("syncPermissions with the full Phase 4A.5 permission vocabulary", () => {
  it("creates every definition on first sync, including both tiers", async () => {
    const result = await syncPermissions({ model: PermissionModel, definitions: ALL_PERMISSION_DEFINITIONS });

    expect(result.created.length).toBe(ALL_PERMISSION_DEFINITIONS.length);
    expect(result.skipped).toHaveLength(0);

    const stored = await PermissionModel.find({}).lean();
    expect(stored).toHaveLength(ALL_PERMISSION_DEFINITIONS.length);

    // Spot-check one from each tier actually landed with the right shape.
    const generated = stored.find((p) => p.key === "Product.read");
    expect(generated?.isSystem).toBe(true);
    const custom = stored.find((p) => p.key === "Payment.verify");
    expect(custom?.isSystem).toBe(false);
  });

  it("a second sync is idempotent — nothing created twice, matching this app's boot-log claim", async () => {
    await syncPermissions({ model: PermissionModel, definitions: ALL_PERMISSION_DEFINITIONS });
    const second = await syncPermissions({ model: PermissionModel, definitions: ALL_PERMISSION_DEFINITIONS });

    expect(second.created).toHaveLength(0);
    expect(second.skipped.length).toBe(ALL_PERMISSION_DEFINITIONS.length);

    const stored = await PermissionModel.find({}).lean();
    expect(stored).toHaveLength(ALL_PERMISSION_DEFINITIONS.length); // no duplicates
  });
});
