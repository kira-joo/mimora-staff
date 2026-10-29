import { Decimal } from "decimal.js";
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VariantModel } from "src/server/catalog/variant.schema";
import { OrderModel } from "src/server/commerce/order.schema";
import { PaymentProofModel } from "src/server/commerce/payment-proof.schema";
import { ReturnModel } from "src/server/commerce/return.schema";
import { connectToDatabase } from "src/server/core/db/connect";
import { InventorySettingsModel } from "src/server/fulfilment/inventory-settings.schema";
import { StaffNotificationModel } from "src/server/notifications/staff-notification.schema";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type RouteHandler } from "../test-support/admin-route-harness";

vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const getToday = (await import("./route")).GET as RouteHandler;

const DAY = 24 * 60 * 60 * 1000;
let counter = 0;
async function order(over: Record<string, unknown> = {}) {
  counter += 1;
  return OrderModel.create({
    orderNumber: `ORD-T${counter}-${new mongoose.Types.ObjectId()}`,
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    guestPhone: "+201000000000",
    fulfilment: { mode: "DELIVERY", fee: toMoney("0.00") },
    subtotal: toMoney("100.00"),
    discount: toMoney("0.00"),
    tax: toMoney("0.00"),
    total: toMoney("100.00"),
    payment: { method: "COD", status: "NOT_REQUIRED" },
    status: "PLACED",
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
    placedAt: new Date(),
    ...over,
  });
}

async function seedStore() {
  await order(); // placed today
  await order({ status: "CONFIRMED" });
  await order({ status: "SHIPPED" });
  await order({ status: "DELIVERED" }); // terminal: not "needing action"
  await order({ status: "CANCELLED" }); // terminal and not counted in today's orders
  await order({ placedAt: new Date(Date.now() - 3 * DAY), status: "PROCESSING" }); // open, but not today's
  const refunded = await order({ total: toMoney("50.25"), subtotal: toMoney("50.25"), payment: { method: "COD", status: "REFUNDED", refund: { amount: toMoney("20.10"), at: new Date(), reference: "r" } } });
  const submitted = await order({ payment: { method: "BANK_TRANSFER", status: "SUBMITTED" } });
  await PaymentProofModel.create({ orderId: submitted._id, submittedAt: new Date(Date.now() - 5 * 60 * 60 * 1000), asset: { publicId: "x", format: "jpg", bytes: 1, mimeType: "image/jpeg", filename: "x.jpg" }, status: "SUBMITTED" });
  for (const status of ["REQUESTED", "REQUESTED", "APPROVED", "RECEIVED", "REJECTED"] as const) {
    await ReturnModel.create({ orderId: refunded._id, customerId: new mongoose.Types.ObjectId(), returnNumber: `RET-${new mongoose.Types.ObjectId()}`, reason: "x", status, requestedAt: new Date() });
  }
  await InventorySettingsModel.create({ lowStockThreshold: 5 });
  const variant = (stock: number, extra: Record<string, unknown> = {}) =>
    VariantModel.create({ productId: new mongoose.Types.ObjectId(), sku: `S-${new mongoose.Types.ObjectId()}`, variantKey: `k-${new mongoose.Types.ObjectId()}`, price: toMoney(10), stock, ...extra });
  await variant(0);
  await variant(3);
  await variant(50);
  await variant(0, { discontinued: true });
  await StaffNotificationModel.create({ type: "NEW_ORDER", title: "New order X", link: "/orders/x", entityType: "Order", entityId: new mongoose.Types.ObjectId(), readBy: [], at: new Date() });
}

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  await Promise.all([OrderModel.deleteMany({}), PaymentProofModel.deleteMany({}), ReturnModel.deleteMany({}), VariantModel.deleteMany({}), InventorySettingsModel.deleteMany({}), StaffNotificationModel.deleteMany({}), removeHarnessStaff()]);
  await seedStore();
});
afterAll(async () => {
  await Promise.all([OrderModel.deleteMany({}), PaymentProofModel.deleteMany({}), ReturnModel.deleteMany({}), VariantModel.deleteMany({}), InventorySettingsModel.deleteMany({}), StaffNotificationModel.deleteMany({}), removeHarnessStaff()]);
  await mongoose.disconnect();
});

const today = async (staff: Awaited<ReturnType<typeof signInAsOwner>>) => {
  const response = await staff.call(getToday, "/api/admin/today");
  return { status: response.status, body: await response.json() };
};

describe("GET /api/admin/today", () => {
  it("the owner sees every section with the right figures", async () => {
    const { status, body } = await today(await signInAsOwner());
    expect(status).toBe(200);
    expect(body.storeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const open = Object.fromEntries(body.orders.open.map((o: { status: string; count: number }) => [o.status, o.count]));
    expect(open).toMatchObject({ PLACED: 3, CONFIRMED: 1, PROCESSING: 1, SHIPPED: 1, READY_FOR_PICKUP: 0 });
    expect(open).not.toHaveProperty("DELIVERED");
    expect(open).not.toHaveProperty("CANCELLED");
    expect(body.orders.placedToday).toBe(6); // all but the cancelled and the three-days-old order

    expect(body.payments.count).toBe(1);
    expect(body.payments.oldestWaitingHours).toBeGreaterThanOrEqual(4);
    expect(body.returns).toEqual({ requested: 2, approved: 1, received: 1 });
    expect(body.stock).toEqual({ outOfStock: 1, lowStock: 1 }); // the discontinued empty variant is not counted
    expect(body.notifications.unread).toBe(1);
    expect(body.notifications.recent[0].title).toBe("New order X");
  });

  it("revenue is net of refunds, exact to the cent, and Money is a decimal string", async () => {
    const { body } = await today(await signInAsOwner());
    // Today, not cancelled: 5 x 100.00 + 50.25 = 550.25 gross; one payment refund of 20.10.
    expect(body.sales.orderCount).toBe(6);
    const money = (value: string) => new Decimal(value).toFixed(2);
    expect(money(body.sales.grossSales)).toBe("550.25");
    expect(money(body.sales.refunds)).toBe("20.10");
    expect(money(body.sales.revenue)).toBe("530.15"); // exact decimal arithmetic, to the cent
    expect(typeof body.sales.revenue).toBe("string");
  });

  it("the server OMITS sections the caller cannot read — they are absent, not hidden", async () => {
    const staff = await signInWithPermissions([AppPermission.ORDER.READ]);
    const { status, body } = await today(staff);
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["asOf", "orders", "storeDate"]);
    for (const absent of ["payments", "returns", "stock", "sales", "notifications"]) expect(body).not.toHaveProperty(absent);
  });

  it("revenue needs Report.read: order access alone does not reveal it, and Report.read alone does not reveal orders", async () => {
    const orderOnly = await today(await signInWithPermissions([AppPermission.ORDER.READ, AppPermission.ORDER.READ_ONE, CustomPermission.PAYMENT_VERIFY]));
    expect(JSON.stringify(orderOnly.body)).not.toMatch(/revenue|grossSales|550\.25/);
    const reportOnly = await today(await signInWithPermissions([CustomPermission.REPORT_READ]));
    expect(Object.keys(reportOnly.body).sort()).toEqual(["asOf", "sales", "storeDate"]);
  });

  it("each panel follows its own permission", async () => {
    const cases: Array<[string, string[]]> = [
      ["payments", [CustomPermission.PAYMENT_VERIFY]],
      ["returns", [AppPermission.RETURN.READ]],
      ["stock", [AppPermission.VARIANT.READ]],
    ];
    for (const [section, permissions] of cases) {
      const { body } = await today(await signInWithPermissions(permissions));
      expect(Object.keys(body).sort(), section).toEqual(["asOf", section, "storeDate"].sort());
    }
  });

  it("notifications in Today obey the per-kind visibility: Notification.read alone shows an empty feed", async () => {
    const { body } = await today(await signInWithPermissions([CustomPermission.NOTIFICATION_READ]));
    expect(body.notifications).toEqual({ unread: 0, recent: [] });
  });

  it("a staff member with none of the panels' permissions is refused (403), and no session is 401", async () => {
    const response = await (await signInWithPermissions([AppPermission.PRODUCT.READ])).call(getToday, "/api/admin/today");
    expect(response.status).toBe(403);
    const { NextRequest } = await import("next/server");
    const { harnessCookieJar } = await import("../test-support/admin-route-harness");
    harnessCookieJar.clear();
    expect((await getToday(new NextRequest("http://localhost/api/admin/today"), { params: Promise.resolve({}) })).status).toBe(401);
  });
});
