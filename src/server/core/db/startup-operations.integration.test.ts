// @vitest-environment node
import { syncPermissions } from "@kira-joo/backend-toolkit-mongoose";
import mongoose, { type Connection, type Model } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMISSION_DEFINITIONS } from "../../../common/authorization/authorization-registry";
import { reconcilePermissions } from "../authorization/reconcile-permissions";
import { PermissionModel } from "../authorization/role.model";
import { ALL_MODELS } from "./model-registry";
import { ensureIndexes } from "./ensure-indexes";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

/**
 * What a cold start costs the database once it is fully set up — the steady state every production cold start is in.
 * A throughput-limited cluster (Atlas M0: 100 operations/second, the rest queued) pays for every command here, once per
 * cold instance, so this pins the cost: no index build, no permission write, one listIndexes per model, one read.
 *
 * Counted on a monitored connection of its own (the application's connection is not monitored), with the real
 * schemas re-registered on it. The previous startup path — build every index, list every index again, upsert every
 * permission — is measured beside it for comparison.
 */
let conn: Connection;
let models: Model<never>[];
let permissions: Model<never>;
const commands: Array<{ name: string; command: Record<string, unknown> }> = [];

beforeAll(async () => {
  conn = await mongoose
    .createConnection(process.env.MONGODB_URI!, { dbName: process.env.MONGODB_DB, autoCreate: false, autoIndex: false, monitorCommands: true })
    .asPromise();
  models = ALL_MODELS.map((model) => conn.model(model.modelName, model.schema, model.collection.collectionName) as unknown as Model<never>);
  permissions = conn.model(PermissionModel.modelName, PermissionModel.schema, PermissionModel.collection.collectionName) as unknown as Model<never>;
  conn.getClient().on("commandStarted", (event) => commands.push({ name: event.commandName, command: event.command as Record<string, unknown> }));
  // Bring the database to its steady state: every index and every permission in place.
  await ensureIndexes(models);
  await reconcilePermissions({ model: permissions, definitions: ALL_PERMISSION_DEFINITIONS });
});
afterAll(async () => {
  await permissions.deleteMany({}); // leave the shared test database's permissions as other files expect them: empty
  await conn.close();
});

/** Commands sent while `work` runs, and the document-level write operations inside them (what a throughput cap counts). */
async function measure(work: () => Promise<unknown>) {
  commands.length = 0;
  await work();
  const byName: Record<string, number> = {};
  let writeOps = 0;
  let indexBuilds = 0;
  for (const { name, command } of commands) {
    byName[name] = (byName[name] ?? 0) + 1;
    if (name === "update") writeOps += (command.updates as unknown[]).length;
    if (name === "insert") writeOps += (command.documents as unknown[]).length;
    if (name === "createIndexes") indexBuilds += (command.indexes as unknown[]).length;
  }
  return { commands: commands.length, byName, writeOps, indexBuilds };
}

describe("database work per cold start, on a fully set-up database", () => {
  it("the new path builds no index and writes no permission: one listIndexes per model plus one read", async () => {
    const indexes = await measure(() => ensureIndexes(models));
    const perms = await measure(() => reconcilePermissions({ model: permissions, definitions: ALL_PERMISSION_DEFINITIONS }));

    expect(indexes.byName.createIndexes ?? 0).toBe(0);
    expect(indexes.indexBuilds).toBe(0);
    expect(indexes.byName.listIndexes).toBe(models.length);
    expect(indexes.commands).toBe(models.length);
    expect(perms.commands).toBe(1);
    expect(perms.byName.find).toBe(1);
    expect(perms.writeOps).toBe(0);
  });

  it("is a large reduction on the previous path (every index rebuilt, re-listed, every permission upserted)", async () => {
    const previous = await measure(async () => {
      await Promise.all(models.map((model) => model.init().then(() => model.createIndexes())));
      await Promise.all(models.map((model) => model.collection.indexes().catch(() => [])));
      await syncPermissions({ model: permissions as never, definitions: ALL_PERMISSION_DEFINITIONS });
    });
    const current = await measure(async () => {
      await ensureIndexes(models);
      await reconcilePermissions({ model: permissions, definitions: ALL_PERMISSION_DEFINITIONS });
    });

    const previousCost = previous.commands + previous.writeOps + previous.indexBuilds;
    const currentCost = current.commands + current.writeOps + current.indexBuilds;
    console.info(`[startup-operations] previous: ${JSON.stringify(previous)} | current: ${JSON.stringify(current)} | cost ${previousCost} -> ${currentCost}`);
    expect(previous.writeOps).toBe(ALL_PERMISSION_DEFINITIONS.length);
    expect(current.writeOps).toBe(0);
    expect(currentCost).toBeLessThan(previousCost / 3);
  });
});
