// @vitest-environment node
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { OrderModel } from "./order.schema";
import { appendOrderTimelineEntry } from "./order-timeline";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await OrderModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

async function seedOrder() {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString()}`,
    guestPhone: "+201000000000",
    idempotencyKey: `k-${new mongoose.Types.ObjectId().toString()}`,
    fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
    subtotal: toMoney("10.00"),
    discount: toMoney("0.00"),
    tax: toMoney("0.00"),
    total: toMoney("10.00"),
    payment: { method: "COD", status: "NOT_REQUIRED" },
    status: "PLACED",
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
    placedAt: new Date(),
  });
}

describe("appendOrderTimelineEntry", () => {
  it("appends a typed entry with every declared field intact", async () => {
    const order = await seedOrder();
    const staffId = new mongoose.Types.ObjectId();

    await withTransaction(async (tx) => {
      await appendOrderTimelineEntry(order._id, {
        type: "ORDER_CONFIRMED",
        at: new Date(2026, 0, 1, 12, 0),
        actorId: staffId,
        actorType: "STAFF",
      });
      return tx.complete(undefined);
    });

    const updated = await OrderModel.findById(order._id).lean();
    expect(updated?.timeline).toHaveLength(2); // the seeded ORDER_PLACED, plus this append
    const entry = updated?.timeline[1];
    expect(entry?.type).toBe("ORDER_CONFIRMED");
    expect(entry?.actorType).toBe("STAFF");
    expect(entry?.actorId?.toString()).toBe(staffId.toString());
  });

  it("requires a reason to be carried when the caller supplies one, e.g. a cancellation", async () => {
    const order = await seedOrder();

    await withTransaction(async (tx) => {
      await appendOrderTimelineEntry(order._id, {
        type: "ORDER_CANCELLED",
        at: new Date(),
        actorType: "CUSTOMER",
        reason: "Changed my mind",
      });
      return tx.complete(undefined);
    });

    const updated = await OrderModel.findById(order._id).lean();
    expect(updated?.timeline.at(-1)?.reason).toBe("Changed my mind");
  });

  it("preserves entry order — the timeline reads chronologically, not just as a set", async () => {
    const order = await seedOrder();

    await withTransaction(async (tx) => {
      await appendOrderTimelineEntry(order._id, { type: "ORDER_CONFIRMED", at: new Date(2026, 0, 1), actorType: "STAFF" });
      return tx.complete(undefined);
    });
    await withTransaction(async (tx) => {
      await appendOrderTimelineEntry(order._id, { type: "ORDER_PROCESSING", at: new Date(2026, 0, 2), actorType: "STAFF" });
      return tx.complete(undefined);
    });

    const updated = await OrderModel.findById(order._id).lean();
    expect(updated?.timeline.map((entry) => entry.type)).toEqual(["ORDER_PLACED", "ORDER_CONFIRMED", "ORDER_PROCESSING"]);
  });

  it("rolls back the append with the rest of the transaction on failure", async () => {
    const order = await seedOrder();

    await expect(
      withTransaction(async () => {
        await appendOrderTimelineEntry(order._id, { type: "ORDER_CONFIRMED", at: new Date(), actorType: "STAFF" });
        throw new Error("simulated failure after the append");
      })
    ).rejects.toThrow("simulated failure");

    const updated = await OrderModel.findById(order._id).lean();
    expect(updated?.timeline).toHaveLength(1); // only the seeded ORDER_PLACED — the append never committed
  });
});
