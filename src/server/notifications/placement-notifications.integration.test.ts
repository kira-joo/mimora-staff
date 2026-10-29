// @vitest-environment node
import { settleBackgroundWork } from "./after-response";
import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductModel } from "../catalog/product.schema";
import { VariantModel } from "../catalog/variant.schema";
import { CartModel } from "../commerce/cart.schema";
import { CartLineModel, buildCartLineIdentityKey } from "../commerce/cart-line.schema";
import { OrderLineModel, OrderModel } from "../commerce/order.schema";
import { OrderSequenceModel } from "../commerce/order-sequence.schema";
import { PageModel } from "../content/page.schema";
import { outboundNotifier } from "../core/notifications";
import { connectToDatabase } from "../core/db/connect";
import { FulfilmentSettingsModel } from "../fulfilment/fulfilment-settings.schema";
import { InventorySettingsModel } from "../fulfilment/inventory-settings.schema";
import { PaymentSettingsModel } from "../fulfilment/payment-settings.schema";
import { PickupLocationModel } from "../fulfilment/pickup-location.schema";
import { placeOrderService } from "../shop/order/place-order";
import { StaffNotificationModel } from "./staff-notification.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const sendSpy = vi.spyOn(outboundNotifier, "send");

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  sendSpy.mockReset();
  sendSpy.mockResolvedValue(undefined);
  await Promise.all([CartModel, CartLineModel, OrderModel, OrderLineModel, VariantModel, ProductModel, PickupLocationModel, FulfilmentSettingsModel, PaymentSettingsModel, OrderSequenceModel, PageModel, StaffNotificationModel, InventorySettingsModel].map((m) => (m as unknown as mongoose.Model<never>).deleteMany({})));
  await PageModel.create({ slug: "terms", title: { en: "Terms", ar: "شروط" }, content: { en: "T", ar: "ش" }, published: true, version: 1 });
  await FulfilmentSettingsModel.create({ deliveryEnabled: true, pickupEnabled: true, shippingFeeMode: "FLAT", flatShippingFee: new Decimal("5.00"), defaultDispatchLeadDays: 2, cutoffTime: "14:00", orderMinimum: new Decimal("0"), customerCancelWindowMinutes: 30, tax: { mode: "INCLUDED", rate: 0 } });
  await PaymentSettingsModel.create({ methods: [{ method: "COD", enabled: true, order: 0, requiresProof: false, requiresProviderIntegration: false }] });
  await InventorySettingsModel.create({ lowStockThreshold: 5 });
});
afterAll(async () => {
  await Promise.all([CartModel, CartLineModel, OrderModel, OrderLineModel, VariantModel, ProductModel, PickupLocationModel, FulfilmentSettingsModel, PaymentSettingsModel, OrderSequenceModel, PageModel, StaffNotificationModel, InventorySettingsModel].map((m) => (m as unknown as mongoose.Model<never>).deleteMany({})));
  await mongoose.disconnect();
});

async function place(stock: number, quantity: number) {
  const customer = { _id: new mongoose.Types.ObjectId().toString(), name: "Test Customer", phone: "+201000000000" };
  const product = await ProductModel.create({ slug: "p-1", categoryId: new mongoose.Types.ObjectId(), name: { en: "P", ar: "م" }, lifecycle: "published" });
  const variant = await VariantModel.create({ productId: product._id, sku: "SKU-N1", variantKey: "k1", stock, price: new Decimal("50.00"), backorderPolicy: "DENY" });
  const location = await PickupLocationModel.create({ name: { en: "Main", ar: "م" }, address: { en: "1 St", ar: "١" }, phone: "555", active: true });
  const cart = await CartModel.create({ customerId: customer._id, fulfilmentDraft: { mode: "PICKUP", pickupLocationId: location._id } });
  await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });
  return placeOrderService({ customer, paymentMethod: "COD", termsVersionAccepted: 1, idempotencyKey: `k-${new mongoose.Types.ObjectId()}`, locale: "en", now: new Date() });
}

describe("placing an order notifies staff", () => {
  it("raises NEW_ORDER, and LOW_STOCK when the sale takes a variant across its threshold", async () => {
    const placed = await place(6, 2); // 6 -> 4, threshold 5
    const notices = await StaffNotificationModel.find({}).lean();
    expect(notices.map((n) => n.type).sort()).toEqual(["LOW_STOCK", "NEW_ORDER"]);
    expect(notices.find((n) => n.type === "NEW_ORDER")).toMatchObject({ link: `/orders/${placed.orderId}`, entityType: "Order" });
    expect(notices.find((n) => n.type === "LOW_STOCK")?.title).toContain("SKU-N1");
  });

  it("raises no LOW_STOCK when the sale leaves stock healthy", async () => {
    await place(50, 2);
    expect(await StaffNotificationModel.countDocuments({ type: "LOW_STOCK" })).toBe(0);
    expect(await StaffNotificationModel.countDocuments({ type: "NEW_ORDER" })).toBe(1);
  });

  it("a failed placement raises nothing", async () => {
    await expect(place(1, 3)).rejects.toThrow(); // more than is in stock
    expect(await StaffNotificationModel.countDocuments({})).toBe(0);
    await settleBackgroundWork();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
