import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { variantRepository } from "../../core/repositories";
import { connectToDatabase } from "../../core/db/connect";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { StockMovementModel } from "../../catalog/stock-movement.schema";
import { OrderModel, OrderLineModel } from "../../commerce/order.schema";
import { PaymentSettingsModel } from "../../fulfilment/payment-settings.schema";
import { expireUnpaidOrders } from "./expire-unpaid-orders";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const injectedSpies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  while (injectedSpies.length > 0) injectedSpies.pop()!.mockRestore();
});

/** Lets the real write land, THEN fails — so the rollback has a write that genuinely happened to undo. */
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

const NOW = new Date("2026-10-23T12:00:00.000Z");
const minutesAgo = (minutes: number, extraMs = 0) => new Date(NOW.getTime() - minutes * 60_000 - extraMs);

async function seedSettings(methods: Array<{ method: string; autoCancelMinutes?: number }>) {
  await PaymentSettingsModel.deleteMany({});
  await PaymentSettingsModel.create({ methods: methods.map((method, order) => ({ ...method, enabled: true, order, requiresProof: true })) });
}

async function seedVariant(stock = 5) {
  const category = await CategoryModel.create({ slug: `cat-${new mongoose.Types.ObjectId()}` });
  const product = await ProductModel.create({ slug: `product-${new mongoose.Types.ObjectId()}`, categoryId: category._id, lifecycle: "published", name: { en: "Test", ar: "تجربة" } });
  return VariantModel.create({ productId: product._id, sku: `SKU-${new mongoose.Types.ObjectId()}`, variantKey: `key-${new mongoose.Types.ObjectId()}`, price: toMoney("10.00"), stock });
}

async function seedOrder(
  overrides: { placedAt?: Date; method?: string; paymentStatus?: "NOT_REQUIRED" | "AWAITING_PAYMENT" | "SUBMITTED" | "VERIFIED" | "REJECTED"; status?: "PLACED" | "CONFIRMED" | "PROCESSING" | "CANCELLED"; variant?: { _id: mongoose.Types.ObjectId; sku: string }; quantity?: number } = {}
) {
  const order = await OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId()}`,
    guestPhone: "+201000000000",
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
    subtotal: toMoney("10.00"),
    discount: toMoney("0.00"),
    tax: toMoney("0.00"),
    total: toMoney("10.00"),
    payment: { method: overrides.method ?? "WALLET_TRANSFER", status: overrides.paymentStatus ?? "AWAITING_PAYMENT" },
    status: overrides.status ?? "PLACED",
    timeline: [{ type: "ORDER_PLACED", at: overrides.placedAt ?? minutesAgo(1000), actorType: "CUSTOMER" }],
    placedAt: overrides.placedAt ?? minutesAgo(1000),
  });
  if (overrides.variant) {
    await OrderLineModel.create({
      orderId: order._id,
      lineNumber: 1,
      variantId: overrides.variant._id,
      sku: overrides.variant.sku,
      productName: "Test",
      variantDescription: "Default",
      quantity: overrides.quantity ?? 2,
      unitPrice: toMoney("10.00"),
      lineTotal: toMoney("20.00"),
    });
  }
  return order;
}

describe("expireUnpaidOrders", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });
  afterAll(async () => {
    await Promise.all([PaymentSettingsModel.deleteMany({}), OrderModel.deleteMany({}), OrderLineModel.deleteMany({}), VariantModel.deleteMany({}), ProductModel.deleteMany({}), CategoryModel.deleteMany({}), StockMovementModel.deleteMany({})]);
    await mongoose.disconnect();
  });
  beforeEach(async () => {
    await Promise.all([PaymentSettingsModel.deleteMany({}), OrderModel.deleteMany({}), OrderLineModel.deleteMany({}), VariantModel.deleteMany({}), ProductModel.deleteMany({}), CategoryModel.deleteMany({}), StockMovementModel.deleteMany({})]);
  });

  it("cancels an unpaid order older than the window: status, a SYSTEM timeline entry with the reason, and the stock back", async () => {
    await seedSettings([{ method: "WALLET_TRANSFER", autoCancelMinutes: 60 }]);
    const variant = await seedVariant(5);
    const order = await seedOrder({ placedAt: minutesAgo(61), variant });

    const result = await expireUnpaidOrders(NOW);

    expect(result).toMatchObject({ cancelled: [order.orderNumber], skipped: 0, failed: [], methodsSwept: ["WALLET_TRANSFER"] });
    const after = await OrderModel.findById(order._id).lean();
    expect(after?.status).toBe("CANCELLED");
    expect(after?.timeline.at(-1)).toMatchObject({ type: "ORDER_CANCELLED", actorType: "SYSTEM" });
    expect(after?.timeline.at(-1)?.reason).toMatch(/60 minutes/);
    expect(after?.timeline.at(-1)?.actorId).toBeUndefined();
    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(7); // 5 + 2 released
    expect(await StockMovementModel.countDocuments({ variantId: variant._id, orderId: order._id, delta: 2 })).toBe(1);
    // The system actor: the movement names the order and the instant, and no person.
    const movement = await StockMovementModel.findOne({ variantId: variant._id }).lean();
    expect(movement?.actorId).toBeUndefined();
    expect(movement?.at.toISOString()).toBe(NOW.toISOString());
  });

  it("the boundary: exactly autoCancelMinutes old is NOT expired, one millisecond older is", async () => {
    await seedSettings([{ method: "WALLET_TRANSFER", autoCancelMinutes: 60 }]);
    const exactly = await seedOrder({ placedAt: minutesAgo(60) });
    const justOver = await seedOrder({ placedAt: minutesAgo(60, 1) });

    const result = await expireUnpaidOrders(NOW);

    expect(result.cancelled).toEqual([justOver.orderNumber]);
    expect((await OrderModel.findById(exactly._id).lean())?.status).toBe("PLACED");
  });

  it("leaves an order inside the window alone", async () => {
    await seedSettings([{ method: "WALLET_TRANSFER", autoCancelMinutes: 60 }]);
    const fresh = await seedOrder({ placedAt: minutesAgo(5) });

    expect((await expireUnpaidOrders(NOW)).cancelled).toEqual([]);
    expect((await OrderModel.findById(fresh._id).lean())?.status).toBe("PLACED");
  });

  it.each(["SUBMITTED", "VERIFIED", "REJECTED", "NOT_REQUIRED"] as const)("never touches an order whose payment is %s, however old", async (paymentStatus) => {
    await seedSettings([{ method: "WALLET_TRANSFER", autoCancelMinutes: 60 }]);
    const variant = await seedVariant(5);
    const order = await seedOrder({ paymentStatus, variant, placedAt: minutesAgo(100_000) });

    const result = await expireUnpaidOrders(NOW);

    expect(result.cancelled).toEqual([]);
    const after = await OrderModel.findById(order._id).lean();
    expect(after?.status).toBe("PLACED");
    expect(after?.timeline).toHaveLength(1);
    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(5);
  });

  it("never touches an order staff have started processing", async () => {
    await seedSettings([{ method: "WALLET_TRANSFER", autoCancelMinutes: 60 }]);
    const order = await seedOrder({ status: "PROCESSING", placedAt: minutesAgo(100_000) });

    expect((await expireUnpaidOrders(NOW)).cancelled).toEqual([]);
    expect((await OrderModel.findById(order._id).lean())?.status).toBe("PROCESSING");
  });

  it("only sweeps methods that configure autoCancelMinutes — a method without one is never cancelled, and each method uses its own window", async () => {
    await seedSettings([{ method: "WALLET_TRANSFER", autoCancelMinutes: 60 }, { method: "INSTAPAY" }, { method: "BANK_TRANSFER", autoCancelMinutes: 0 }]);
    const wallet = await seedOrder({ method: "WALLET_TRANSFER", placedAt: minutesAgo(90) });
    const instapay = await seedOrder({ method: "INSTAPAY", placedAt: minutesAgo(100_000) });
    const bank = await seedOrder({ method: "BANK_TRANSFER", placedAt: minutesAgo(100_000) });

    const result = await expireUnpaidOrders(NOW);

    expect(result.cancelled).toEqual([wallet.orderNumber]);
    expect(result.methodsSwept).toEqual(["WALLET_TRANSFER"]);
    expect((await OrderModel.findById(instapay._id).lean())?.status).toBe("PLACED");
    expect((await OrderModel.findById(bank._id).lean())?.status).toBe("PLACED");
  });

  it("reports the sweep as OFF (no methods swept) when no method has a window, and cancels nothing", async () => {
    await seedSettings([{ method: "WALLET_TRANSFER" }]);
    await seedOrder({ placedAt: minutesAgo(100_000) });

    expect(await expireUnpaidOrders(NOW)).toMatchObject({ cancelled: [], methodsSwept: [] });
  });

  it("with no payment settings document at all, does nothing and does not throw", async () => {
    await seedOrder({ placedAt: minutesAgo(100_000) });
    expect(await expireUnpaidOrders(NOW)).toMatchObject({ cancelled: [], methodsSwept: [] });
  });

  it("is idempotent: a second run cancels nothing, releases no more stock, and adds no timeline entry", async () => {
    await seedSettings([{ method: "WALLET_TRANSFER", autoCancelMinutes: 60 }]);
    const variant = await seedVariant(5);
    const order = await seedOrder({ placedAt: minutesAgo(120), variant });

    await expireUnpaidOrders(NOW);
    const second = await expireUnpaidOrders(new Date(NOW.getTime() + 60_000));

    expect(second.cancelled).toEqual([]);
    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(7);
    expect(await StockMovementModel.countDocuments({ variantId: variant._id })).toBe(1);
    expect((await OrderModel.findById(order._id).lean())?.timeline).toHaveLength(2);
  });

  it("two sweeps racing each other release the stock once", async () => {
    await seedSettings([{ method: "WALLET_TRANSFER", autoCancelMinutes: 60 }]);
    const variant = await seedVariant(5);
    await seedOrder({ placedAt: minutesAgo(120), variant });

    const results = await Promise.all([expireUnpaidOrders(NOW), expireUnpaidOrders(NOW)]);

    expect(results.reduce((total, result) => total + result.cancelled.length, 0)).toBe(1);
    expect(results.flatMap((result) => result.failed)).toEqual([]); // the loser is a skip, never an error
    expect(results.reduce((total, result) => total + result.skipped, 0)).toBe(1);
    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(7);
    expect(await StockMovementModel.countDocuments({ variantId: variant._id })).toBe(1);
  });

  it("rollback: when the stock release fails after it wrote, the order stays awaiting payment with its stock, timeline and movements untouched — and a re-run succeeds", async () => {
    await seedSettings([{ method: "WALLET_TRANSFER", autoCancelMinutes: 60 }]);
    const variant = await seedVariant(5);
    const order = await seedOrder({ placedAt: minutesAgo(120), variant });
    failAfterWrite(variantRepository, "updateAtomic", 1); // the stock increment lands, THEN the transaction fails

    const result = await expireUnpaidOrders(NOW);

    expect(result.cancelled).toEqual([]);
    expect(result.failed).toEqual([{ orderNumber: order.orderNumber, message: "injected failure" }]);
    const after = await OrderModel.findById(order._id).lean();
    expect(after?.status).toBe("PLACED");
    expect(after?.timeline).toHaveLength(1);
    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(5);
    expect(await StockMovementModel.countDocuments({ variantId: variant._id })).toBe(0);

    while (injectedSpies.length > 0) injectedSpies.pop()!.mockRestore();
    expect((await expireUnpaidOrders(NOW)).cancelled).toEqual([order.orderNumber]);
    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(7);
  });

  it("one order's failure does not stop the others", async () => {
    await seedSettings([{ method: "WALLET_TRANSFER", autoCancelMinutes: 60 }]);
    const variantA = await seedVariant(5);
    const variantB = await seedVariant(5);
    const first = await seedOrder({ placedAt: minutesAgo(300), variant: variantA });
    const second = await seedOrder({ placedAt: minutesAgo(200), variant: variantB });
    failAfterWrite(variantRepository, "updateAtomic", 1); // fails the oldest order only

    const result = await expireUnpaidOrders(NOW);

    expect(result.failed.map((failure) => failure.orderNumber)).toEqual([first.orderNumber]);
    expect(result.cancelled).toEqual([second.orderNumber]);
    expect((await OrderModel.findById(first._id).lean())?.status).toBe("PLACED");
    expect((await VariantModel.findById(variantA._id).lean())?.stock).toBe(5);
    expect((await VariantModel.findById(variantB._id).lean())?.stock).toBe(7);
  });
});
