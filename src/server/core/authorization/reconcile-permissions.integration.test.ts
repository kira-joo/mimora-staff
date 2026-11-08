// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ALL_PERMISSION_DEFINITIONS } from "../../../common/authorization/authorization-registry";
import { connectToDatabase } from "../db/connect";
import { PermissionModel, RoleModel } from "./role.model";
import { reconcilePermissions } from "./reconcile-permissions";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

/**
 * The boot-time permission reconciliation against the real `Permission` collection: one read, and a write only for a
 * permission that is missing or whose canonical fields drifted. A routine boot writes nothing.
 */
const run = () => reconcilePermissions({ model: PermissionModel, definitions: ALL_PERMISSION_DEFINITIONS });
const TOTAL = ALL_PERMISSION_DEFINITIONS.length;
const raw = () => PermissionModel.collection.find({}).sort({ key: 1 }).toArray();

const clear = () => Promise.all([PermissionModel.deleteMany({}), RoleModel.deleteMany({})]);
beforeAll(async () => {
  await connectToDatabase();
  await clear(); // the database is shared between test files: start from a known-empty collection
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([PermissionModel.deleteMany({}), RoleModel.deleteMany({})]);
});
afterAll(() => mongoose.disconnect());

describe("reconcilePermissions", () => {
  it("missing: an empty collection gets every definition, both tiers, with the right shape", async () => {
    const result = await run();

    expect(result.created).toHaveLength(TOTAL);
    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual([]);
    const stored = await PermissionModel.find({}).lean();
    expect(stored).toHaveLength(TOTAL);
    for (const definition of ALL_PERMISSION_DEFINITIONS) {
      const doc = stored.find((p) => p.key === definition.key);
      expect(doc).toMatchObject({ entity: definition.entity, action: definition.action, name: definition.name, isSystem: definition.isSystem ?? false, isActive: true });
    }
    expect(stored.find((p) => p.key === "Product.read")?.isSystem).toBe(true);
    expect(stored.find((p) => p.key === "Payment.verify")?.isSystem).toBe(false);
  });

  it("already correct: a repeat run reads once, writes nothing, and leaves every document byte-identical", async () => {
    await run();
    const before = await raw();
    const find = vi.spyOn(PermissionModel, "find");
    const bulkWrite = vi.spyOn(PermissionModel, "bulkWrite");

    const result = await run();

    expect(result).toEqual({ created: [], updated: [], skipped: ALL_PERMISSION_DEFINITIONS.map((d) => d.key) });
    expect(find).toHaveBeenCalledTimes(1);
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(await raw()).toEqual(before); // updatedAt included: nothing was touched
  });

  it("outdated: drifted canonical fields are corrected, and only those documents are written", async () => {
    await run();
    const [a, b, c] = ALL_PERMISSION_DEFINITIONS;
    const owner = await PermissionModel.collection.findOne({ key: a!.key });
    await PermissionModel.collection.updateOne({ key: a!.key }, { $set: { name: "Old display name", isActive: false } });
    await PermissionModel.collection.updateOne({ key: b!.key }, { $set: { isSystem: !(b!.isSystem ?? false), entity: "Legacy" } });
    await PermissionModel.collection.updateOne({ key: c!.key }, { $set: { action: "legacyAction" } });
    const untouchedBefore = (await raw()).filter((doc) => ![a!.key, b!.key, c!.key].includes(doc.key as string));
    const bulkWrite = vi.spyOn(PermissionModel, "bulkWrite");

    const result = await run();

    expect(result.created).toEqual([]);
    expect(result.updated.sort()).toEqual([a!.key, b!.key, c!.key].sort());
    expect(result.skipped).toHaveLength(TOTAL - 3);
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    expect((bulkWrite.mock.calls[0]![0] as unknown[]).length).toBe(3); // three writes, not one per permission

    const fixedA = await PermissionModel.collection.findOne({ key: a!.key });
    expect(fixedA).toMatchObject({ name: a!.name, isActive: false }); // isActive is the operator's, never overwritten
    expect(String(fixedA!._id)).toBe(String(owner!._id)); // same document: roles keep resolving it
    expect(fixedA!.createdAt).toEqual(owner!.createdAt);
    expect(await PermissionModel.findOne({ key: b!.key }).lean()).toMatchObject({ entity: b!.entity, isSystem: b!.isSystem ?? false });
    expect(await PermissionModel.findOne({ key: c!.key }).lean()).toMatchObject({ action: c!.action });
    // Every other document is exactly as it was.
    expect((await raw()).filter((doc) => ![a!.key, b!.key, c!.key].includes(doc.key as string))).toEqual(untouchedBefore);
  });

  it("missing + outdated + correct together; a permission outside the definitions is never deleted or changed", async () => {
    await run();
    const [gone, stale] = ALL_PERMISSION_DEFINITIONS;
    await PermissionModel.collection.deleteOne({ key: gone!.key });
    await PermissionModel.collection.updateOne({ key: stale!.key }, { $set: { name: "Stale" } });
    await PermissionModel.collection.insertOne({ key: "Custom.merchantMade", entity: "Custom", action: "merchantMade", name: "Merchant made", isSystem: false, isActive: true });

    const result = await run();

    expect(result.created).toEqual([gone!.key]);
    expect(result.updated).toEqual([stale!.key]);
    expect(result.skipped).toHaveLength(TOTAL - 2);
    expect(await PermissionModel.countDocuments({})).toBe(TOTAL + 1);
    expect(await PermissionModel.findOne({ key: "Custom.merchantMade" }).lean()).toMatchObject({ name: "Merchant made", isActive: true });
  });

  it("idempotent and concurrency-safe: simultaneous cold starts on an empty collection create each permission once", async () => {
    const results = await Promise.all([run(), run(), run()]);

    expect(await PermissionModel.countDocuments({})).toBe(TOTAL);
    expect(new Set((await PermissionModel.find({}).lean()).map((p) => p.key)).size).toBe(TOTAL);
    for (const result of results) expect(result.created.length + result.updated.length + result.skipped.length).toBe(TOTAL);
    const again = await run();
    expect(again.created).toEqual([]);
    expect(again.updated).toEqual([]);
  });

  it("role references survive a reconciliation that fixes drift", async () => {
    await run();
    const target = ALL_PERMISSION_DEFINITIONS[0]!;
    const permission = await PermissionModel.findOne({ key: target.key }).lean();
    await RoleModel.create({ name: "Reconcile probe", grantsAll: false, isActive: true, permissions: [permission!._id] });
    await PermissionModel.collection.updateOne({ key: target.key }, { $set: { name: "Drifted" } });

    await run();

    const role = await RoleModel.findOne({ name: "Reconcile probe" }).lean();
    const resolved = await PermissionModel.findById(role!.permissions![0]).lean();
    expect(resolved).toMatchObject({ key: target.key, name: target.name });
  });
});
