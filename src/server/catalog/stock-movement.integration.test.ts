// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { StockMovementModel } from "./stock-movement.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase(); // asserts every declared index, including this schema's
});

afterEach(async () => {
  await StockMovementModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("StockMovement", () => {
  it("persists a SALE movement with a negative delta and an order reference", async () => {
    const orderId = new mongoose.Types.ObjectId();
    const movement = await StockMovementModel.create({
      variantId: new mongoose.Types.ObjectId(),
      delta: -2,
      reason: "SALE",
      orderId,
      actorId: new mongoose.Types.ObjectId(),
    });

    const found = await StockMovementModel.findById(movement._id).lean();
    expect(found?.delta).toBe(-2);
    expect(found?.reason).toBe("SALE");
    expect(found?.orderId?.toString()).toBe(orderId.toString());
    expect(found?.at).toBeInstanceOf(Date); // defaulted
  });

  it("persists a RECEIPT movement with a positive delta and no order — a standalone restock", async () => {
    const movement = await StockMovementModel.create({
      variantId: new mongoose.Types.ObjectId(),
      delta: 50,
      reason: "RECEIPT",
      actorId: new mongoose.Types.ObjectId(),
      note: "Supplier delivery #123",
    });

    expect(movement.orderId).toBeUndefined();
    expect(movement.delta).toBe(50);
  });

  it("rejects an unrecognised reason", async () => {
    await expect(
      StockMovementModel.create({ variantId: new mongoose.Types.ObjectId(), delta: 1, reason: "MADE_UP" as never, actorId: new mongoose.Types.ObjectId() })
    ).rejects.toThrow();
  });
});
