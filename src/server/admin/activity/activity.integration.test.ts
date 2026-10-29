import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { ActivityLogModel } from "../../core/activity-log.schema";
import { StaffUserModel } from "../../identity/staff-user.schema";
import { listActivity } from "./list-activity";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

describe("Admin Activity", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([ActivityLogModel.deleteMany({}), StaffUserModel.deleteMany({})]);
  });

  afterEach(async () => {
    await Promise.all([ActivityLogModel.deleteMany({}), StaffUserModel.deleteMany({})]);
  });

  async function seed() {
    const alice = await StaffUserModel.create({ name: "Alice", email: "alice@example.com" });
    const bob = await StaffUserModel.create({ name: "Bob", email: "bob@example.com" });
    const productId = new mongoose.Types.ObjectId();

    const entry = (actorId: mongoose.Types.ObjectId, action: string, entityType: string, at: Date, entityId?: mongoose.Types.ObjectId) => {
      // `createdAt` is set explicitly so ordering doesn't depend on insert timing; the schema type omits timestamp fields.
      const document = { actorId, action, entityType, entityId, changes: { name: "x" }, createdAt: at, updatedAt: at };
      return ActivityLogModel.create(document);
    };

    await entry(alice._id, "create", "Product", new Date("2026-09-01T10:00:00Z"), productId);
    await entry(bob._id, "update", "Product", new Date("2026-09-02T10:00:00Z"), productId);
    await entry(alice._id, "verify", "Payment", new Date("2026-09-03T10:00:00Z"), new mongoose.Types.ObjectId());
    await entry(bob._id, "manage", "Permission", new Date("2026-09-04T10:00:00Z"));

    return { alice, bob, productId };
  }

  it("lists newest first with the actor's name and email attached", async () => {
    const { bob } = await seed();
    const result = await listActivity({ page: 1, limit: 10 });

    expect(result.total).toBe(4);
    expect(result.data.map((entry) => entry.action)).toEqual(["manage", "verify", "update", "create"]);
    expect(result.data[0].actor).toEqual({ _id: bob._id.toString(), name: "Bob", email: "bob@example.com" });
    expect(result.data[0].entityId).toBeUndefined();
    expect(result.data[0].at).toEqual(new Date("2026-09-04T10:00:00Z"));
  });

  it("gives one record's full history from entityType + entityId", async () => {
    const { productId } = await seed();
    const result = await listActivity({ page: 1, limit: 10, entityType: "Product", entityId: productId.toString() });
    expect(result.data.map((entry) => entry.action)).toEqual(["update", "create"]);
  });

  it("filters by actor, by action, and by time window", async () => {
    const { alice } = await seed();

    const byActor = await listActivity({ page: 1, limit: 10, actorId: alice._id.toString() });
    expect(byActor.data.map((entry) => entry.action)).toEqual(["verify", "create"]);

    const byAction = await listActivity({ page: 1, limit: 10, action: "verify" });
    expect(byAction.total).toBe(1);

    const window = await listActivity({ page: 1, limit: 10, from: "2026-09-02T00:00:00Z", to: "2026-09-03T23:59:59Z" });
    expect(window.data.map((entry) => entry.action)).toEqual(["verify", "update"]);
  });

  it("paginates", async () => {
    await seed();
    const page2 = await listActivity({ page: 2, limit: 3 });
    expect(page2.total).toBe(4);
    expect(page2.totalPages).toBe(2);
    expect(page2.data.map((entry) => entry.action)).toEqual(["create"]);
  });
});
