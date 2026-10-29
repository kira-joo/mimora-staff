import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { orderRepository } from "../../core/repositories";
import { connectToDatabase } from "../../core/db/connect";
import { OrderModel } from "../../commerce/order.schema";
import { PaymentProofModel } from "../../commerce/payment-proof.schema";
import { PaymentSettingsModel } from "../../fulfilment/payment-settings.schema";
import { verifyPayment } from "./verify-payment";
import { rejectPayment } from "./reject-payment";
import { refundPayment } from "./refund-payment";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const injectedSpies: Array<{ mockRestore(): void }> = [];

afterEach(() => {
  while (injectedSpies.length > 0) injectedSpies.pop()!.mockRestore();
});

/**
 * Rollback-test injection. Lets the real write land, THEN fails the `nth` call
 * to `repo[method]` — so the rollback has a write that genuinely happened to
 * undo. Failing before the write would prove nothing about atomicity.
 */
function failAfterWrite(repo: object, method: string, nth = 1): void {
  const target = repo as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = target[method]!.bind(repo);
  let calls = 0;
  const spy = vi.spyOn(target, method).mockImplementation(async (...args: unknown[]) => {
    const result = await original(...args);
    calls += 1;
    if (calls === nth) throw new Error("injected failure");
    return result;
  });
  injectedSpies.push(spy);
}

// listPaymentQueue mints a signed URL via privateAssets() — mocked the same
// way submit-payment-proof.integration.test.ts does, since real Cloudinary
// credentials aren't configured for tests.
vi.mock("../../core/assets/asset-providers", () => ({
  privateAssets: vi.fn(),
}));

import { privateAssets } from "../../core/assets/asset-providers";
import { listPaymentQueue } from "./list-payment-queue";

function mockSignedUrl() {
  const signedUrl = vi.fn().mockReturnValue("https://signed.example/proof");
  vi.mocked(privateAssets).mockReturnValue({ upload: vi.fn(), destroy: vi.fn(), signedUrl } as unknown as ReturnType<typeof privateAssets>);
  return signedUrl;
}

async function seedOrder(paymentStatus: "AWAITING_PAYMENT" | "SUBMITTED" | "VERIFIED" | "NOT_REQUIRED" = "SUBMITTED") {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString()}`,
    guestPhone: "+201000000000",
    idempotencyKey: `k-${new mongoose.Types.ObjectId().toString()}`,
    fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
    subtotal: toMoney("100.00"),
    discount: toMoney("0.00"),
    tax: toMoney("0.00"),
    total: toMoney("100.00"),
    payment: { method: "WALLET_TRANSFER", status: paymentStatus },
    status: "PLACED",
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
    placedAt: new Date(),
  });
}

async function seedProof(orderId: mongoose.Types.ObjectId) {
  return PaymentProofModel.create({
    orderId,
    submittedAt: new Date(),
    asset: { publicId: "proofs/x", format: "jpg", bytes: 100, mimeType: "image/jpeg", filename: "x.jpg" },
    status: "SUBMITTED",
  });
}

describe("Admin Payments", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([OrderModel.deleteMany({}), PaymentProofModel.deleteMany({}), PaymentSettingsModel.deleteMany({})]);
  });

  describe("verifyPayment", () => {
    it("verifies a submitted payment and marks the matching proof VERIFIED", async () => {
      const order = await seedOrder("SUBMITTED");
      const proof = await seedProof(order._id);
      const staffId = new mongoose.Types.ObjectId().toString();

      const updated = await verifyPayment({ orderId: order._id.toString(), staffId, now: new Date() });

      expect(updated.payment.status).toBe("VERIFIED");
      expect(updated.payment.verification?.verifiedBy?.toString()).toBe(staffId);
      expect(updated.timeline).toHaveLength(2);

      const updatedProof = await PaymentProofModel.findById(proof._id).lean();
      expect(updatedProof?.status).toBe("VERIFIED");
    });

    it("verifies a COD (NOT_REQUIRED) payment with no proof row at all", async () => {
      const order = await seedOrder("NOT_REQUIRED");
      const updated = await verifyPayment({ orderId: order._id.toString(), staffId: new mongoose.Types.ObjectId().toString(), now: new Date() });
      expect(updated.payment.status).toBe("VERIFIED");
    });

    it("throws ConflictError when payment cannot transition to VERIFIED", async () => {
      const order = await seedOrder("AWAITING_PAYMENT");
      await expect(
        verifyPayment({ orderId: order._id.toString(), staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })
      ).rejects.toThrow(ConflictError);
    });

    it("throws NotFoundError for a non-existent order", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(verifyPayment({ orderId: fakeId, staffId: fakeId, now: new Date() })).rejects.toThrow(NotFoundError);
    });
  });

  describe("rejectPayment", () => {
    it("rejects a submitted payment with a reason", async () => {
      const order = await seedOrder("SUBMITTED");
      const proof = await seedProof(order._id);
      const staffId = new mongoose.Types.ObjectId().toString();

      const updated = await rejectPayment({ orderId: order._id.toString(), reason: "Amount mismatch", staffId, now: new Date() });

      expect(updated.payment.status).toBe("REJECTED");
      expect(updated.payment.verification?.rejectionReason).toBe("Amount mismatch");

      const updatedProof = await PaymentProofModel.findById(proof._id).lean();
      expect(updatedProof?.status).toBe("REJECTED");
      expect(updatedProof?.rejectionReason).toBe("Amount mismatch");
    });
  });

  describe("listPaymentQueue", () => {
    it("lists the oldest-placed payment first — the one that has waited longest", async () => {
      const older = await seedOrder("SUBMITTED");
      const newer = await seedOrder("SUBMITTED");
      await OrderModel.updateOne({ _id: older._id }, { $set: { placedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
      await OrderModel.updateOne({ _id: newer._id }, { $set: { placedAt: new Date(Date.now() - 60 * 60 * 1000) } });
      mockSignedUrl();

      const result = await listPaymentQueue({ limit: 10, page: 1 });
      expect(result.data.map((item) => item.orderId)).toEqual([older._id.toString(), newer._id.toString()]);
    });

    it("lists only SUBMITTED payments with a signed proof URL, and includes a COD order with no proof", async () => {
      const submitted = await seedOrder("SUBMITTED");
      await seedProof(submitted._id);
      await seedOrder("VERIFIED");
      const codOrder = await seedOrder("NOT_REQUIRED");
      await OrderModel.updateOne({ _id: codOrder._id }, { $set: { "payment.status": "SUBMITTED", "payment.method": "COD" } });

      const signedUrl = mockSignedUrl();
      const result = await listPaymentQueue({ limit: 10, page: 1 });

      expect(result.total).toBe(2);
      const withProof = result.data.find((item) => item.orderId === submitted._id.toString());
      expect(withProof?.proof?.signedUrl).toBe("https://signed.example/proof");
      expect(signedUrl).toHaveBeenCalledWith({ publicId: "proofs/x", format: "jpg" }, 300);

      const withoutProof = result.data.find((item) => item.orderId === codOrder._id.toString());
      expect(withoutProof?.proof).toBeUndefined();
    });
  });

  describe("listPaymentQueue — verificationWindowMinutes flags overdue proofs", () => {
    const NOW = new Date("2026-10-23T12:00:00.000Z");
    const submittedAgo = async (minutes: number, extraMs = 0) => {
      const order = await seedOrder("SUBMITTED");
      const proof = await seedProof(order._id);
      await PaymentProofModel.updateOne({ _id: proof._id }, { $set: { submittedAt: new Date(NOW.getTime() - minutes * 60_000 - extraMs) } });
      return order._id.toString();
    };
    const overdueById = async () => new Map((await listPaymentQueue({ limit: 20, page: 1 }, NOW)).data.map((item) => [item.orderId, item]));

    it("flags a proof strictly older than its method's window — and not one exactly at it — without changing anything", async () => {
      await PaymentSettingsModel.create({ methods: [{ method: "WALLET_TRANSFER", enabled: true, order: 0, requiresProof: true, verificationWindowMinutes: 120 }] });
      mockSignedUrl();
      const atBoundary = await submittedAgo(120);
      const past = await submittedAgo(120, 1);
      const fresh = await submittedAgo(10);

      const items = await overdueById();

      expect(items.get(atBoundary)).toMatchObject({ overdue: false, verificationWindowMinutes: 120 });
      expect(items.get(past)).toMatchObject({ overdue: true, verificationWindowMinutes: 120 });
      expect(items.get(fresh)?.overdue).toBe(false);
      // Flag only: staff decide, nothing is verified, rejected or cancelled by the clock.
      expect((await OrderModel.findById(past).lean())?.payment.status).toBe("SUBMITTED");
      expect((await OrderModel.findById(past).lean())?.status).toBe("PLACED");
    });

    it("nothing is overdue when the method configures no window (the clock is off)", async () => {
      await PaymentSettingsModel.create({ methods: [{ method: "WALLET_TRANSFER", enabled: true, order: 0, requiresProof: true }] });
      mockSignedUrl();
      const ancient = await submittedAgo(100_000);

      expect((await overdueById()).get(ancient)).toMatchObject({ overdue: false, verificationWindowMinutes: undefined });
    });

    it("an order with no proof is never overdue, and the queue still answers with no settings document at all", async () => {
      const order = await seedOrder("SUBMITTED");

      expect((await overdueById()).get(order._id.toString())?.overdue).toBe(false);
    });
  });

  describe("refundPayment", () => {
    it.each([
      ["blank", ""],
      ["whitespace only", "   "],
      ["missing", undefined as unknown as string],
    ])("refuses a %s reference (D-12): nothing is recorded, reserved or appended", async (_label, reference) => {
      const order = await seedOrder("VERIFIED");

      await expect(refundPayment({ orderId: order._id.toString(), amount: toMoney("10.00"), reference, staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })).rejects.toThrow(
        ConflictError
      );

      const after = await OrderModel.findById(order._id).lean();
      expect(after?.payment.status).toBe("VERIFIED");
      expect(after?.payment.refund).toBeUndefined();
      expect(Number(String(after?.refundedTotal ?? 0))).toBe(0);
      expect(after?.timeline).toHaveLength(1);
    });

    it("stores the reference trimmed", async () => {
      const order = await seedOrder("VERIFIED");

      const updated = await refundPayment({ orderId: order._id.toString(), amount: toMoney("10.00"), reference: "  TXN-5  ", staffId: new mongoose.Types.ObjectId().toString(), now: new Date() });

      expect(updated.payment.refund?.reference).toBe("TXN-5");
    });


    it("refunds a verified payment for the explicit amount, and moves the order's refundedTotal", async () => {
      const order = await seedOrder("VERIFIED");
      const staffId = new mongoose.Types.ObjectId().toString();

      const updated = await refundPayment({ orderId: order._id.toString(), amount: toMoney("100.00"), reference: "TXN-1", staffId, now: new Date() });

      expect(updated.payment.status).toBe("REFUNDED");
      expect(updated.payment.refund?.amount?.toFixed(2)).toBe("100.00");
      expect(updated.refundedTotal.toFixed(2)).toBe("100.00");
    });

    it("throws ConflictError when refunding an unpaid order", async () => {
      const order = await seedOrder("AWAITING_PAYMENT");
      await expect(
        refundPayment({ orderId: order._id.toString(), amount: toMoney("10.00"), reference: "TXN-2", staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("rollback: a failure inside the transaction leaves no partial state", () => {
    const staff = () => new mongoose.Types.ObjectId().toString();

    it("verifyPayment: payment status, verification, proof and timeline all revert", async () => {
      const order = await seedOrder("SUBMITTED");
      const proof = await seedProof(order._id);
      failAfterWrite(orderRepository, "updateAtomic", 2); // 1 = status $set, 2 = timeline $push (the last write)

      await expect(verifyPayment({ orderId: order._id.toString(), staffId: staff(), now: new Date() })).rejects.toThrow("injected failure");

      const after = await OrderModel.findById(order._id).lean();
      expect(after?.payment.status).toBe("SUBMITTED");
      expect(after?.payment.verification).toBeUndefined();
      expect(after?.timeline).toHaveLength(1);
      expect((await PaymentProofModel.findById(proof._id).lean())?.status).toBe("SUBMITTED");
    });

    it("rejectPayment: payment status, rejection reason, proof and timeline all revert", async () => {
      const order = await seedOrder("SUBMITTED");
      const proof = await seedProof(order._id);
      failAfterWrite(orderRepository, "updateAtomic", 2);

      await expect(
        rejectPayment({ orderId: order._id.toString(), reason: "Blurry", staffId: staff(), now: new Date() })
      ).rejects.toThrow("injected failure");

      const after = await OrderModel.findById(order._id).lean();
      expect(after?.payment.status).toBe("SUBMITTED");
      expect(after?.payment.verification).toBeUndefined();
      expect(after?.timeline).toHaveLength(1);
      const afterProof = await PaymentProofModel.findById(proof._id).lean();
      expect(afterProof?.status).toBe("SUBMITTED");
      expect(afterProof?.rejectionReason).toBeUndefined();
    });

    it("refundPayment: the reserved refundedTotal, refund record, status and timeline all revert", async () => {
      const order = await seedOrder("VERIFIED");
      failAfterWrite(orderRepository, "updateAtomic", 3); // 1 = reserveOrderRefund, 2 = status $set, 3 = timeline $push

      await expect(
        refundPayment({ orderId: order._id.toString(), amount: toMoney("100.00"), reference: "TXN-3", staffId: staff(), now: new Date() })
      ).rejects.toThrow("injected failure");

      const after = await OrderModel.findById(order._id).lean();
      expect(after?.payment.status).toBe("VERIFIED");
      expect(after?.payment.refund).toBeUndefined();
      expect(Number(String(after?.refundedTotal ?? 0))).toBe(0);
      expect(after?.timeline).toHaveLength(1);
    });
  });
});
