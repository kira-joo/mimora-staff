// @vitest-environment node
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { OrderModel } from "./order.schema";
import { PaymentProofModel } from "./payment-proof.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([OrderModel.deleteMany({}), PaymentProofModel.deleteMany({})]);
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
    payment: { method: "WALLET_TRANSFER", status: "AWAITING_PAYMENT" },
    status: "PLACED",
    placedAt: new Date(),
  });
}

describe("PaymentProof — submission history, distinct from Order.payment's current state", () => {
  it("never stores a public/deliverable URL, only the private-asset reference fields", async () => {
    const order = await seedOrder();
    const proof = await PaymentProofModel.create({
      orderId: order._id,
      submittedAt: new Date(),
      asset: { publicId: "proofs/abc123", format: "jpg", bytes: 204800, mimeType: "image/jpeg", filename: "receipt.jpg" },
      status: "SUBMITTED",
    });

    const found = await PaymentProofModel.findById(proof._id).lean();
    expect(found?.asset.publicId).toBe("proofs/abc123");
    // No field on this schema can hold a URL at all — asserting the object's
    // own key set is exactly the four private-reference fields plus the two
    // upload-metadata fields, nothing resembling `secureUrl`/`url`.
    expect(Object.keys(found?.asset ?? {}).sort()).toEqual(["bytes", "filename", "format", "mimeType", "publicId"]);
  });

  it("a rejected-then-resubmitted proof keeps BOTH rows — the rejected one is not overwritten", async () => {
    const order = await seedOrder();

    const firstProof = await PaymentProofModel.create({
      orderId: order._id,
      submittedAt: new Date(2026, 0, 1),
      asset: { publicId: "proofs/first", format: "jpg", bytes: 1000, mimeType: "image/jpeg", filename: "first.jpg" },
      status: "REJECTED",
      reviewedBy: new mongoose.Types.ObjectId(),
      reviewedAt: new Date(2026, 0, 2),
      rejectionReason: "Amount does not match the order total",
    });

    const secondProof = await PaymentProofModel.create({
      orderId: order._id,
      submittedAt: new Date(2026, 0, 3),
      asset: { publicId: "proofs/second", format: "jpg", bytes: 1200, mimeType: "image/jpeg", filename: "second.jpg" },
      status: "SUBMITTED",
    });

    const history = await PaymentProofModel.find({ orderId: order._id }).sort({ submittedAt: 1 }).lean();
    expect(history).toHaveLength(2);
    expect(history[0]?._id.toString()).toBe(firstProof._id.toString());
    expect(history[0]?.status).toBe("REJECTED");
    expect(history[0]?.rejectionReason).toBe("Amount does not match the order total"); // still visible, not lost
    expect(history[1]?._id.toString()).toBe(secondProof._id.toString());
    expect(history[1]?.status).toBe("SUBMITTED");
  });
});
