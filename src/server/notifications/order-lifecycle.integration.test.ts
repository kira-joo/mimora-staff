// @vitest-environment node
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VariantModel } from "../catalog/variant.schema";
import { OrderModel, type OrderTimelineEntry } from "../commerce/order.schema";
import { appendOrderTimelineEntry } from "../commerce/order-timeline";
import { outboundNotifier } from "../core/notifications";
import { connectToDatabase } from "../core/db/connect";
import { applyStockMovement } from "../engines/inventory/apply-stock-movement";
import { CustomerModel } from "../identity/customer.schema";
import { InventorySettingsModel } from "../fulfilment/inventory-settings.schema";
import { NotificationSettingsModel } from "../fulfilment/notification-settings.schema";
import { settleBackgroundWork } from "./after-response";
import { notifyOrderLifecycle } from "./order-lifecycle";
import { StaffNotificationModel } from "./staff-notification.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const sendSpy = vi.spyOn(outboundNotifier, "send");

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(() => {
  sendSpy.mockReset();
  sendSpy.mockResolvedValue(undefined);
});
afterEach(async () => {
  await Promise.all([OrderModel.deleteMany({}), NotificationSettingsModel.deleteMany({}), StaffNotificationModel.deleteMany({}), CustomerModel.deleteMany({}), VariantModel.deleteMany({}), InventorySettingsModel.deleteMany({})]);
});
afterAll(async () => {
  await mongoose.disconnect();
});

async function seedOrder(overrides: Record<string, unknown> = {}) {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString()}`,
    guestPhone: "+201000000000",
    guestEmail: "buyer@example.com",
    guestName: "Buyer",
    idempotencyKey: `k-${new mongoose.Types.ObjectId().toString()}`,
    fulfilment: { mode: "DELIVERY", fee: toMoney("0.00") },
    subtotal: toMoney("10.00"),
    discount: toMoney("0.00"),
    tax: toMoney("0.00"),
    total: toMoney("10.00"),
    payment: { method: "COD", status: "NOT_REQUIRED" },
    status: "PLACED",
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
    placedAt: new Date(),
    ...overrides,
  });
}

const enable = (...events: Array<{ event: string; channels?: Array<"EMAIL" | "SMS"> }>) =>
  NotificationSettingsModel.create({ events: events.map((e) => ({ event: e.event, channels: e.channels ?? ["EMAIL"], recipientRoles: [] })) });

const entry = (type: OrderTimelineEntry["type"], extra: Partial<OrderTimelineEntry> = {}): OrderTimelineEntry => ({ type, at: new Date(), actorType: "STAFF", ...extra });

async function appendInTransaction(orderId: mongoose.Types.ObjectId, e: OrderTimelineEntry, afterAppend?: () => void) {
  return withTransaction(async (tx) => {
    await appendOrderTimelineEntry(orderId, e);
    afterAppend?.();
    return tx.complete(undefined);
  });
}

describe("order emails — dispatched after commit", () => {
  it("sends the email once the transaction has committed, and not before", async () => {
    await enable({ event: "ORDER_SHIPPED" });
    const order = await seedOrder();

    await appendInTransaction(order._id, entry("ORDER_SHIPPED"), () => {
      // Still inside the transaction: nothing may have been sent yet.
      expect(sendSpy).not.toHaveBeenCalled();
    });

    await settleBackgroundWork(); // the email is dispatched after the response, so wait for it
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = sendSpy.mock.calls[0]![0];
    expect(sent).toMatchObject({ channel: "EMAIL", to: "buyer@example.com", template: "order-shipped" });
    expect(sent.subject).toContain(order.orderNumber);
    expect(sent.body).toContain(order.orderNumber);
    expect(sent.html).toContain(order.orderNumber);
  });

  it("does NOT send when the transaction rolls back (the test that matters)", async () => {
    await enable({ event: "ORDER_SHIPPED" }, { event: "PAYMENT_SUBMITTED" });
    const order = await seedOrder();

    await expect(
      withTransaction(async () => {
        await appendOrderTimelineEntry(order._id, entry("ORDER_SHIPPED"));
        await appendOrderTimelineEntry(order._id, entry("PAYMENT_SUBMITTED"));
        throw new Error("something later in the transaction failed");
      })
    ).rejects.toThrow("something later");

    await settleBackgroundWork(); // the email is dispatched after the response, so wait for it
    expect(sendSpy).not.toHaveBeenCalled();
    expect(await StaffNotificationModel.countDocuments({})).toBe(0);
    expect((await OrderModel.findById(order._id).lean())?.timeline).toHaveLength(1); // the append rolled back too
  });

  it("sends immediately after the write when no transaction is active", async () => {
    await enable({ event: "ORDER_CONFIRMED" });
    const order = await seedOrder();
    await appendOrderTimelineEntry(order._id, entry("ORDER_CONFIRMED"));
    await settleBackgroundWork(); // the email is dispatched after the response, so wait for it
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ template: "order-confirmed", to: "buyer@example.com" }));
  });

  it("respects the toggles: no settings, no rule for the event, or EMAIL not ticked — nothing is sent", async () => {
    const order = await seedOrder();
    await appendOrderTimelineEntry(order._id, entry("ORDER_SHIPPED")); // no settings document at all
    await settleBackgroundWork(); // the email is dispatched after the response, so wait for it
    expect(sendSpy).not.toHaveBeenCalled();

    await enable({ event: "ORDER_CONFIRMED" }, { event: "ORDER_SHIPPED", channels: ["SMS"] });
    await appendOrderTimelineEntry(order._id, entry("ORDER_SHIPPED")); // SMS only
    await appendOrderTimelineEntry(order._id, entry("ORDER_DELIVERED")); // no rule
    await settleBackgroundWork(); // the email is dispatched after the response, so wait for it
    expect(sendSpy).not.toHaveBeenCalled();

    await appendOrderTimelineEntry(order._id, entry("ORDER_CONFIRMED")); // ticked
    await settleBackgroundWork(); // the email is dispatched after the response, so wait for it
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the order has no contact email — and the append still succeeds", async () => {
    await enable({ event: "ORDER_SHIPPED" });
    const order = await seedOrder({ guestEmail: undefined });
    await appendOrderTimelineEntry(order._id, entry("ORDER_SHIPPED"));
    await settleBackgroundWork(); // the email is dispatched after the response, so wait for it
    expect(sendSpy).not.toHaveBeenCalled();
    expect((await OrderModel.findById(order._id).lean())?.timeline).toHaveLength(2);
  });

  it("a signed-in customer's order is emailed at the customer's address", async () => {
    await enable({ event: "ORDER_DELIVERED" });
    const customer = await CustomerModel.create({ phone: `+2010${Math.floor(Math.random() * 100000000)}`, email: "member@example.com", passwordHash: "x", name: "Member" });
    const order = await seedOrder({ guestEmail: undefined, guestName: undefined, customerId: customer._id });
    await appendOrderTimelineEntry(order._id, entry("ORDER_DELIVERED"));
    await settleBackgroundWork(); // the email is dispatched after the response, so wait for it
    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ to: "member@example.com", template: "order-delivered" }));
  });

  it("a pickup order's COLLECTED step emails the 'collected' message, not 'delivered'", async () => {
    await enable({ event: "ORDER_COLLECTED" });
    const order = await seedOrder({ fulfilment: { mode: "PICKUP", fee: toMoney("0.00") } });
    await appendOrderTimelineEntry(order._id, entry("ORDER_COLLECTED"));
    await settleBackgroundWork();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = sendSpy.mock.calls[0]![0];
    expect(sent).toMatchObject({ channel: "EMAIL", to: "buyer@example.com", template: "order-collected" });
    expect(sent.subject).toContain(order.orderNumber);
    expect(sent.body.toLowerCase()).not.toContain("delivered");
  });

  it("COLLECTED sends nothing until the merchant ticks it", async () => {
    await enable({ event: "ORDER_DELIVERED" });
    const order = await seedOrder();
    await appendOrderTimelineEntry(order._id, entry("ORDER_COLLECTED"));
    await settleBackgroundWork();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("events with no email mapping send nothing, even when the merchant ticked them", async () => {
    const types = ["ORDER_PROCESSING", "ORDER_IN_TRANSIT", "ORDER_TRACKING_UPDATED", "PAYMENT_SUBMITTED", "RETURN_REQUESTED", "RETURN_APPROVED", "RETURN_REJECTED", "RETURN_RECEIVED", "SOME_FUTURE_EVENT"];
    await enable(...types.map((event) => ({ event })));
    const order = await seedOrder();
    for (const type of types) await appendOrderTimelineEntry(order._id, entry(type as OrderTimelineEntry["type"]));
    await settleBackgroundWork(); // the email is dispatched after the response, so wait for it
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("a payment rejection carries the staff-written reason; a refund carries the amount", async () => {
    await enable({ event: "PAYMENT_REJECTED" }, { event: "PAYMENT_REFUNDED" });
    const order = await seedOrder({ payment: { method: "BANK_TRANSFER", status: "REJECTED", verification: { rejectionReason: "Receipt unreadable" }, refund: { amount: toMoney("4.00"), at: new Date() } } });
    await appendOrderTimelineEntry(order._id, entry("PAYMENT_REJECTED", { reason: "Receipt unreadable" }));
    await appendOrderTimelineEntry(order._id, entry("PAYMENT_REFUNDED"));
    await settleBackgroundWork(); // the email is dispatched after the response, so wait for it
    expect(sendSpy.mock.calls[0]![0].body).toContain("Receipt unreadable");
    await settleBackgroundWork(); // the email is dispatched after the response, so wait for it
    expect(sendSpy.mock.calls[1]![0]).toMatchObject({ template: "refund-recorded" });
    await settleBackgroundWork(); // the email is dispatched after the response, so wait for it
    expect(sendSpy.mock.calls[1]![0].body).toContain("4.00");
  });

  it("a slow transport does not hold the operation: the response is not blocked by the email", async () => {
    await enable({ event: "ORDER_SHIPPED" });
    const order = await seedOrder();
    let delivered = false;
    sendSpy.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      delivered = true;
    });

    const started = Date.now();
    await appendOrderTimelineEntry(order._id, entry("ORDER_SHIPPED"));
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(400); // would be 600ms+ if the SMTP round trip were awaited
    expect(delivered).toBe(false);
    await settleBackgroundWork();
    expect(delivered).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("a failing transport never fails the operation, and the staff notice is still raised", async () => {
    await enable({ event: "ORDER_PLACED" });
    sendSpy.mockRejectedValue(new Error("smtp down"));
    const order = await seedOrder();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(notifyOrderLifecycle(order._id, { type: "ORDER_PLACED" })).resolves.toBeUndefined();
    await settleBackgroundWork();
    expect(sendSpy).toHaveBeenCalled(); // the transport really was attempted, and really failed
    expect(await StaffNotificationModel.countDocuments({ type: "NEW_ORDER" })).toBe(1);
  });
});

describe("staff notifications — raised after commit", () => {
  it("a placed order raises NEW_ORDER", async () => {
    const order = await seedOrder();
    await notifyOrderLifecycle(order._id, { type: "ORDER_PLACED" });
    const [n] = await StaffNotificationModel.find({}).lean();
    expect(n).toMatchObject({ type: "NEW_ORDER", entityType: "Order", link: `/orders/${order._id}` });
    expect(n?.title).toContain(order.orderNumber);
    expect(n?.readBy).toEqual([]);
  });

  it("a payment proof raises PAYMENT_PROOF_SUBMITTED only after commit, and a rollback raises nothing", async () => {
    const order = await seedOrder();
    let writtenInsideTransaction = -1;
    await withTransaction(async (tx) => {
      await appendOrderTimelineEntry(order._id, entry("PAYMENT_SUBMITTED", { actorType: "CUSTOMER" }));
      // Outside the session's view this would be 0 either way, so look through a plain read of the collection.
      writtenInsideTransaction = await StaffNotificationModel.countDocuments({});
      return tx.complete(undefined);
    });
    expect(writtenInsideTransaction).toBe(0);
    expect(await StaffNotificationModel.countDocuments({ type: "PAYMENT_PROOF_SUBMITTED" })).toBe(1);
  });

  it("a requested return raises RETURN_REQUESTED", async () => {
    const order = await seedOrder();
    await appendOrderTimelineEntry(order._id, entry("RETURN_REQUESTED", { actorType: "CUSTOMER" }));
    expect(await StaffNotificationModel.countDocuments({ type: "RETURN_REQUESTED" })).toBe(1);
  });

  it("ordinary transitions raise no staff notice", async () => {
    const order = await seedOrder();
    for (const type of ["ORDER_CONFIRMED", "ORDER_SHIPPED", "ORDER_DELIVERED"] as const) await appendOrderTimelineEntry(order._id, entry(type));
    expect(await StaffNotificationModel.countDocuments({})).toBe(0);
  });
});

describe("staff notifications — retention", () => {
  it("every notice expires 90 days after the event, and the database holds a TTL index that will delete it", async () => {
    const order = await seedOrder();
    await notifyOrderLifecycle(order._id, { type: "ORDER_PLACED" });
    const [n] = await StaffNotificationModel.find({}).lean();
    expect(n?.expiresAt).toBeInstanceOf(Date);
    expect(n!.expiresAt!.getTime() - n!.at.getTime()).toBe(90 * 24 * 60 * 60 * 1000);

    const indexes = await StaffNotificationModel.collection.indexes();
    expect(indexes.find((index) => JSON.stringify(index.key) === JSON.stringify({ expiresAt: 1 }))).toMatchObject({ expireAfterSeconds: 0 });
  });
});

describe("low-stock notices", () => {
  async function seedVariant(stock: number, lowStockThreshold?: number) {
    await InventorySettingsModel.create({ lowStockThreshold: 5 });
    return VariantModel.create({ productId: new mongoose.Types.ObjectId(), sku: `SKU-${new mongoose.Types.ObjectId()}`, variantKey: `k-${new mongoose.Types.ObjectId()}`, price: toMoney(10), stock, ...(lowStockThreshold === undefined ? {} : { lowStockThreshold }) });
  }
  const adjust = (variantId: mongoose.Types.ObjectId, delta: number) =>
    withTransaction(async (tx) => {
      await applyStockMovement({ variantId, delta, reason: "ADJUSTMENT", actorId: new mongoose.Types.ObjectId() });
      return tx.complete(undefined);
    });

  it("crossing down into the threshold raises LOW_STOCK", async () => {
    const variant = await seedVariant(7);
    await adjust(variant._id, -3); // 7 -> 4, threshold 5
    const [n] = await StaffNotificationModel.find({ type: "LOW_STOCK" }).lean();
    expect(n).toMatchObject({ entityType: "Variant" });
    expect(n?.title).toContain(variant.sku);
  });

  it("does not raise one when stock was already low, when it stays healthy, or when it goes up", async () => {
    const low = await seedVariant(4);
    await adjust(low._id, -1);
    const healthy = await seedVariant(20);
    await adjust(healthy._id, -2);
    await adjust(low._id, +10);
    expect(await StaffNotificationModel.countDocuments({ type: "LOW_STOCK" })).toBe(0);
  });

  it("a per-variant threshold overrides the store default", async () => {
    const variant = await seedVariant(12, 10);
    await adjust(variant._id, -3); // 12 -> 9, per-variant threshold 10 (default 5 would not fire)
    expect(await StaffNotificationModel.countDocuments({ type: "LOW_STOCK" })).toBe(1);
  });

  it("a rolled-back adjustment raises nothing", async () => {
    const variant = await seedVariant(7);
    await expect(
      withTransaction(async () => {
        await applyStockMovement({ variantId: variant._id, delta: -6, reason: "ADJUSTMENT", actorId: new mongoose.Types.ObjectId() });
        throw new Error("abort");
      })
    ).rejects.toThrow("abort");
    expect(await StaffNotificationModel.countDocuments({})).toBe(0);
  });
});
