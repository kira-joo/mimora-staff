import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { submitPaymentProof } from "./submit-payment-proof";
import { OrderModel } from "../../commerce/order.schema";
import { orderRepository } from "../../core/repositories";
import { PaymentProofModel } from "../../commerce/payment-proof.schema";
import { PaymentSettingsModel } from "../../fulfilment/payment-settings.schema";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";
import type { ParsedMultipartFile } from "@kira-joo/backend-toolkit-next";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

vi.mock("../../core/assets/asset-providers", () => ({
  privateAssets: vi.fn(),
}));

import { privateAssets } from "../../core/assets/asset-providers";

function customerIdentity(): CustomerIdentity {
  return { _id: new mongoose.Types.ObjectId().toString(), name: "Test Customer", phone: "+201000000000" };
}

function testFile(overrides: Partial<ParsedMultipartFile> = {}): ParsedMultipartFile {
  return {
    buffer: Buffer.from("fake-image-bytes"),
    filename: "receipt.jpg",
    mimeType: "image/jpeg",
    size: 16,
    ...overrides,
  };
}

async function createPaymentSettings(methods: Array<Record<string, unknown>>) {
  return PaymentSettingsModel.create({ methods });
}

async function createOrder(customerId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `test-key-${new mongoose.Types.ObjectId().toString()}`,
    customerId,
    status: "PLACED",
    placedAt: new Date(),
    subtotal: new Decimal("100.00"),
    total: new Decimal("100.00"),
    fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
    payment: { method: "TRANSFER", status: "AWAITING_PAYMENT" },
    ...overrides,
  });
}

function mockUploadOnce(ref: { publicId: string; format: string; bytes: number }) {
  const upload = vi.fn().mockResolvedValue(ref);
  const destroy = vi.fn().mockResolvedValue(undefined);
  vi.mocked(privateAssets).mockReturnValue({ upload, destroy, signedUrl: vi.fn() } as unknown as ReturnType<typeof privateAssets>);
  return { upload, destroy };
}

describe("submitPaymentProof", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await PaymentSettingsModel.deleteMany({});
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await OrderModel.deleteMany({});
    await PaymentProofModel.deleteMany({});
    await PaymentSettingsModel.deleteMany({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits proof successfully: creates a PaymentProof row, sets Order.payment.status to SUBMITTED, appends a timeline entry", async () => {
    const customer = customerIdentity();
    await createPaymentSettings([{ method: "TRANSFER", enabled: true, order: 0, requiresProof: true, requiresProviderIntegration: false }]);
    const order = await createOrder(customer._id);
    const { upload } = mockUploadOnce({ publicId: "payment-proofs/abc", format: "jpg", bytes: 16 });

    const result = await submitPaymentProof({ customer, orderNumber: order.orderNumber, file: testFile(), now: new Date() });

    expect(result.paymentStatus).toBe("SUBMITTED");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(expect.anything(), { folder: `mimora/payment-proofs/orders/${order.orderNumber}` });

    const proofs = await PaymentProofModel.find({ orderId: order._id }).lean();
    expect(proofs).toHaveLength(1);
    expect(proofs[0]!._id.toString()).toBe(result.proofId);
    expect(proofs[0]!.asset.publicId).toBe("payment-proofs/abc");
    expect(proofs[0]!.asset.mimeType).toBe("image/jpeg");
    expect(proofs[0]!.asset.filename).toBe("receipt.jpg");
    expect(proofs[0]!.status).toBe("SUBMITTED");

    const updatedOrder = await OrderModel.findById(order._id).lean();
    expect(updatedOrder?.payment.status).toBe("SUBMITTED");
    expect(updatedOrder?.timeline).toHaveLength(1);
    expect(updatedOrder?.timeline[0]!.type).toBe("PAYMENT_SUBMITTED");
    expect(updatedOrder?.timeline[0]!.actorType).toBe("CUSTOMER");
  });

  it("throws NotFoundError when the order does not exist", async () => {
    const customer = customerIdentity();

    await expect(
      submitPaymentProof({ customer, orderNumber: "ORD-999999", file: testFile(), now: new Date() })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when the order belongs to a different customer", async () => {
    const owner = customerIdentity();
    const intruder = customerIdentity();
    await createPaymentSettings([{ method: "TRANSFER", enabled: true, order: 0, requiresProof: true, requiresProviderIntegration: false }]);
    const order = await createOrder(owner._id);

    await expect(
      submitPaymentProof({ customer: intruder, orderNumber: order.orderNumber, file: testFile(), now: new Date() })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when the order's payment method is not configured in PaymentSettings", async () => {
    const customer = customerIdentity();
    // No PaymentSettings document at all.
    const order = await createOrder(customer._id);

    await expect(
      submitPaymentProof({ customer, orderNumber: order.orderNumber, file: testFile(), now: new Date() })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when the order's payment method is disabled", async () => {
    const customer = customerIdentity();
    await createPaymentSettings([{ method: "TRANSFER", enabled: false, order: 0, requiresProof: true, requiresProviderIntegration: false }]);
    const order = await createOrder(customer._id);

    await expect(
      submitPaymentProof({ customer, orderNumber: order.orderNumber, file: testFile(), now: new Date() })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError when the payment method does not require proof, even though it is enabled", async () => {
    const customer = customerIdentity();
    await createPaymentSettings([{ method: "COD", enabled: true, order: 0, requiresProof: false, requiresProviderIntegration: false }]);
    const order = await createOrder(customer._id, { payment: { method: "COD", status: "NOT_REQUIRED" } });

    await expect(
      submitPaymentProof({ customer, orderNumber: order.orderNumber, file: testFile(), now: new Date() })
    ).rejects.toThrow(ConflictError);
  });

  it("throws ConflictError when the current payment status does not allow a transition to SUBMITTED", async () => {
    const customer = customerIdentity();
    await createPaymentSettings([{ method: "TRANSFER", enabled: true, order: 0, requiresProof: true, requiresProviderIntegration: false }]);
    const order = await createOrder(customer._id, { payment: { method: "TRANSFER", status: "VERIFIED" } });

    await expect(
      submitPaymentProof({ customer, orderNumber: order.orderNumber, file: testFile(), now: new Date() })
    ).rejects.toThrow(ConflictError);
  });

  it("allows resubmission after rejection: creates a second history row and keeps the rejected one intact", async () => {
    const customer = customerIdentity();
    await createPaymentSettings([{ method: "TRANSFER", enabled: true, order: 0, requiresProof: true, requiresProviderIntegration: false }]);
    const order = await createOrder(customer._id, { payment: { method: "TRANSFER", status: "REJECTED" } });

    const rejected = await PaymentProofModel.create({
      orderId: order._id,
      submittedAt: new Date(Date.now() - 60_000),
      asset: { publicId: "payment-proofs/first", format: "jpg", bytes: 10, mimeType: "image/jpeg", filename: "first.jpg" },
      status: "REJECTED",
      reviewedBy: new mongoose.Types.ObjectId(),
      reviewedAt: new Date(),
      rejectionReason: "Amount does not match",
    });

    mockUploadOnce({ publicId: "payment-proofs/second", format: "jpg", bytes: 16 });

    const result = await submitPaymentProof({ customer, orderNumber: order.orderNumber, file: testFile({ filename: "second.jpg" }), now: new Date() });

    expect(result.paymentStatus).toBe("SUBMITTED");

    const history = await PaymentProofModel.find({ orderId: order._id }).sort({ submittedAt: 1 }).lean();
    expect(history).toHaveLength(2);
    expect(history[0]!._id.toString()).toBe(rejected._id.toString());
    expect(history[0]!.status).toBe("REJECTED");
    expect(history[0]!.rejectionReason).toBe("Amount does not match");
    expect(history[1]!.status).toBe("SUBMITTED");
    expect(history[1]!.asset.filename).toBe("second.jpg");
  });

  it("leaves the database unchanged when the Cloudinary upload fails", async () => {
    const customer = customerIdentity();
    await createPaymentSettings([{ method: "TRANSFER", enabled: true, order: 0, requiresProof: true, requiresProviderIntegration: false }]);
    const order = await createOrder(customer._id);

    const upload = vi.fn().mockRejectedValue(new Error("Cloudinary is unavailable"));
    const destroy = vi.fn();
    vi.mocked(privateAssets).mockReturnValue({ upload, destroy, signedUrl: vi.fn() } as unknown as ReturnType<typeof privateAssets>);

    await expect(
      submitPaymentProof({ customer, orderNumber: order.orderNumber, file: testFile(), now: new Date() })
    ).rejects.toThrow("Cloudinary is unavailable");

    expect(await PaymentProofModel.countDocuments({ orderId: order._id })).toBe(0);
    const unchangedOrder = await OrderModel.findById(order._id).lean();
    expect(unchangedOrder?.payment.status).toBe("AWAITING_PAYMENT");
    expect(destroy).not.toHaveBeenCalled();
  });

  it("cleans up the uploaded asset via tx.onAbort when the DB transaction fails after a successful upload", async () => {
    const customer = customerIdentity();
    await createPaymentSettings([{ method: "TRANSFER", enabled: true, order: 0, requiresProof: true, requiresProviderIntegration: false }]);
    const order = await createOrder(customer._id);
    const { destroy } = mockUploadOnce({ publicId: "payment-proofs/orphan", format: "jpg", bytes: 16 });

    const updateOneSpy = vi.spyOn(orderRepository, "updateAtomic").mockRejectedValueOnce(new Error("simulated DB failure"));

    await expect(
      submitPaymentProof({ customer, orderNumber: order.orderNumber, file: testFile(), now: new Date() })
    ).rejects.toThrow();

    updateOneSpy.mockRestore();

    // The transaction rolled back: no PaymentProof row survives, Order untouched.
    expect(await PaymentProofModel.countDocuments({ orderId: order._id })).toBe(0);
    const unchangedOrder = await OrderModel.findById(order._id).lean();
    expect(unchangedOrder?.payment.status).toBe("AWAITING_PAYMENT");

    // The orphaned upload was cleaned up.
    expect(destroy).toHaveBeenCalledWith("payment-proofs/orphan");
  });
});
