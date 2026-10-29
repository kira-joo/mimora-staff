import mongoose from "mongoose";
import { Decimal } from "decimal.js";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { OrderModel } from "src/server/commerce/order.schema";
import { PaymentProofModel } from "src/server/commerce/payment-proof.schema";
import { PaymentSettingsModel } from "src/server/fulfilment/payment-settings.schema";
import { submitPaymentProof } from "src/server/shop/order/submit-payment-proof";
import { removeHarnessStaff, signInAsOwner, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * Route-level: a transfer / InstaPay / wallet order is not handed over until
 * staff verify the payment. The same engine rule is unit-tested; this proves
 * it holds through the real HTTP route (auth, validation, 409 mapping) and
 * that the intended path — submit proof, verify, ship, deliver — still works.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

vi.mock("src/server/core/assets/asset-providers", () => ({ privateAssets: vi.fn() }));
import { privateAssets } from "src/server/core/assets/asset-providers";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const putStatus = (await import("./[id]/status/route")).PUT as RouteHandler;
const putVerify = (await import("./[id]/payment/verify/route")).PUT as RouteHandler;

const MESSAGE = "Payment has not been verified — verify the receipt before shipping.";

let admin: AdminCaller;

async function seedOrder(status: "PROCESSING" | "SHIPPED", paymentStatus: "AWAITING_PAYMENT" | "SUBMITTED" | "REJECTED" | "NOT_REQUIRED") {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    guestPhone: "+201000000000",
    status,
    placedAt: new Date(),
    subtotal: new Decimal("10.00"),
    total: new Decimal("10.00"),
    fulfilment: { mode: "DELIVERY", fee: toMoney("0.00") },
    payment: { method: paymentStatus === "NOT_REQUIRED" ? "COD" : "TRANSFER", status: paymentStatus },
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
  });
}

async function seedVariant(stock = 5) {
  const category = await CategoryModel.create({ slug: `cat-${new mongoose.Types.ObjectId()}` });
  const product = await ProductModel.create({ slug: `p-${new mongoose.Types.ObjectId()}`, categoryId: category._id, lifecycle: "published", name: { en: "T", ar: "ت" } });
  return VariantModel.create({ productId: product._id, sku: `SKU-${new mongoose.Types.ObjectId()}`, variantKey: `k-${new mongoose.Types.ObjectId()}`, price: toMoney("10.00"), stock });
}

const move = (id: string, status: string) => admin.call(putStatus, `/api/admin/orders/${id}/status`, { method: "PUT", body: { status }, params: { id } });
const verify = (id: string) => admin.call(putVerify, `/api/admin/orders/${id}/payment/verify`, { method: "PUT", body: {}, params: { id } });

beforeAll(async () => {
  await connectToDatabase();
  admin = await signInAsOwner();
});

afterAll(async () => {
  await Promise.all([removeHarnessStaff(), OrderModel.deleteMany({}), PaymentProofModel.deleteMany({}), PaymentSettingsModel.deleteMany({}), VariantModel.deleteMany({}), ProductModel.deleteMany({}), CategoryModel.deleteMany({})]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([OrderModel.deleteMany({}), PaymentProofModel.deleteMany({}), PaymentSettingsModel.deleteMany({}), VariantModel.deleteMany({}), ProductModel.deleteMany({}), CategoryModel.deleteMany({})]);
});

describe("PUT /api/admin/orders/:id/status — payment guard", () => {
  for (const paymentStatus of ["AWAITING_PAYMENT", "SUBMITTED", "REJECTED"] as const) {
    it(`409s shipping while payment is ${paymentStatus}; order, timeline and stock unchanged`, async () => {
      const variant = await seedVariant();
      const order = await seedOrder("PROCESSING", paymentStatus);

      const response = await move(order._id.toString(), "SHIPPED");

      expect(response.status).toBe(409);
      expect(JSON.stringify(await response.json())).toContain(MESSAGE);
      const after = await OrderModel.findById(order._id).lean();
      expect(after?.status).toBe("PROCESSING");
      expect(after?.timeline).toHaveLength(1);
      expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(5);
    });

    it(`409s delivering while payment is ${paymentStatus}`, async () => {
      const order = await seedOrder("SHIPPED", paymentStatus);

      const response = await move(order._id.toString(), "DELIVERED");

      expect(response.status).toBe(409);
      expect(JSON.stringify(await response.json())).toContain(MESSAGE);
      expect((await OrderModel.findById(order._id).lean())?.status).toBe("SHIPPED");
    });
  }

  it("lets a COD order ship while unpaid", async () => {
    const order = await seedOrder("PROCESSING", "NOT_REQUIRED");
    expect((await move(order._id.toString(), "SHIPPED")).status).toBe(200);
  });

  it("submit proof -> staff verify -> ship -> deliver succeeds", async () => {
    await PaymentSettingsModel.create({ methods: [{ method: "TRANSFER", enabled: true, order: 0, requiresProof: true, requiresProviderIntegration: false }] });
    vi.mocked(privateAssets).mockReturnValue({
      upload: vi.fn().mockResolvedValue({ publicId: "payment-proofs/x", format: "jpg", bytes: 16 }),
      destroy: vi.fn(),
      signedUrl: vi.fn(),
    } as unknown as ReturnType<typeof privateAssets>);
    const order = await seedOrder("PROCESSING", "AWAITING_PAYMENT");
    const id = order._id.toString();

    await submitPaymentProof({
      guestOrderId: id,
      orderNumber: order.orderNumber,
      file: { buffer: Buffer.from("x"), filename: "r.jpg", mimeType: "image/jpeg", size: 1 },
      now: new Date(),
    });
    expect((await OrderModel.findById(id).lean())?.payment.status).toBe("SUBMITTED");

    expect((await move(id, "SHIPPED")).status).toBe(409);

    expect((await verify(id)).status).toBe(200);
    expect((await move(id, "SHIPPED")).status).toBe(200);
    expect((await move(id, "DELIVERED")).status).toBe(200);
    expect((await OrderModel.findById(id).lean())?.status).toBe("DELIVERED");
  });
});
