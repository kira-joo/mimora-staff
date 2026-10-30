// @vitest-environment node
import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { CartLineModel, buildCartLineIdentityKey } from "../../commerce/cart-line.schema";
import { CartModel } from "../../commerce/cart.schema";
import { OrderLineModel, OrderModel } from "../../commerce/order.schema";
import { OrderSequenceModel } from "../../commerce/order-sequence.schema";
import { PageModel } from "../../content/page.schema";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";
import { connectToDatabase } from "../../core/db/connect";
import { DeliveryZoneModel } from "../../fulfilment/delivery-zone.schema";
import { FulfilmentSettingsModel } from "../../fulfilment/fulfilment-settings.schema";
import { OperatingHoursModel } from "../../fulfilment/operating-hours.schema";
import { PaymentSettingsModel } from "../../fulfilment/payment-settings.schema";
import { PickupLocationModel } from "../../fulfilment/pickup-location.schema";
import { placeOrderService } from "../order/place-order";
import { generateQuote } from "./generate-quote";
import { transitionOrderStatus } from "../../admin/orders/transition-order-status";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STORE_TIMEZONE = "Africa/Cairo";

/*
 * The quote is a promise and placement is the same promise made binding: the dates a customer is shown at
 * checkout must be the dates the order carries, whatever the store's zone, cutoff and opening hours do to them.
 */

const customer: CustomerIdentity = { _id: new mongoose.Types.ObjectId().toString(), name: "Test Customer", phone: "+201000000000" };
// Thursday 27 August 2026, 15:00 in Cairo (UTC+3): past the 14:00 cutoff.
const now = new Date("2026-08-27T12:00:00Z");
const sunThu = [0, 1, 2, 3, 4].map((weekday) => ({ weekday, ranges: [{ open: "09:00", close: "17:00" }] }));

async function seed(options: { exceptions?: Array<{ date: Date; closed: boolean; ranges: [] }>; mode?: "DELIVERY" | "PICKUP"; maxDaysAhead?: number; shippingDays?: number[]; leadDaysMin?: number; leadDays?: number } = {}) {
  await FulfilmentSettingsModel.create({
    deliveryEnabled: true,
    pickupEnabled: true,
    shippingFeeMode: "BY_ZONE",
    defaultDispatchLeadDays: 1,
    cutoffTime: "14:00",
    maxDaysAhead: options.maxDaysAhead ?? 14,
    customerCancelWindowMinutes: 30,
    tax: { mode: "ADDED", rate: 0 },
    ...(options.shippingDays ? { shippingDays: options.shippingDays } : {}),
  });
  await PaymentSettingsModel.create({ methods: [{ method: "COD", enabled: true, order: 0, requiresProof: false, requiresProviderIntegration: false }] });
  await PageModel.create({ slug: "terms", title: { en: "Terms", ar: "شروط" }, content: { en: "T", ar: "ش" }, published: true, version: 1 });
  await DeliveryZoneModel.create({ name: { en: "Cairo", ar: "القاهرة" }, fee: new Decimal("25.00"), leadDays: options.leadDays ?? 2, ...(options.leadDaysMin !== undefined ? { leadDaysMin: options.leadDaysMin } : {}), active: true });
  await OperatingHoursModel.create({ weekly: sunThu, exceptions: options.exceptions ?? [] });

  const product = await ProductModel.create({ slug: "p", categoryId: new mongoose.Types.ObjectId(), name: { en: "P", ar: "م" }, lifecycle: "published" });
  const variant = await VariantModel.create({ productId: product._id, sku: "SKU-1", variantKey: "k1", stock: 10, price: new Decimal("100.00"), backorderPolicy: "DENY" });

  const pickup = await PickupLocationModel.create({ name: { en: "Shop", ar: "متجر" }, address: { en: "1 St", ar: "١" }, phone: "555-0100", active: true });
  const mode = options.mode ?? "DELIVERY";
  const cart = await CartModel.create({
    customerId: customer._id,
    fulfilmentDraft:
      mode === "DELIVERY"
        ? { mode, address: { recipientName: "R", phone: "+201000000000", addressLine1: "1 St", city: "Cairo", governorate: "Cairo" } }
        : { mode, pickupLocationId: pickup._id },
  });
  await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });
}

async function quoteAndPlace() {
  const quote = await generateQuote({ actor: { kind: "customer", customer }, locale: "en", now });
  const placed = await placeOrderService({ customer, paymentMethod: "COD", termsVersionAccepted: 1, idempotencyKey: `k-${new mongoose.Types.ObjectId()}`, locale: "en", now });
  const order = await OrderModel.findById(placed.orderId).lean();
  return { quote, placed, order };
}

beforeAll(async () => {
  await connectToDatabase();
});
const COLLECTIONS = [FulfilmentSettingsModel, PaymentSettingsModel, PageModel, DeliveryZoneModel, OperatingHoursModel, ProductModel, VariantModel, PickupLocationModel, CartModel, CartLineModel, OrderModel, OrderLineModel, OrderSequenceModel];
const wipe = () => Promise.all(COLLECTIONS.map((model) => (model as typeof CartModel).deleteMany({})));
beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await mongoose.disconnect();
});

describe("the quote and the order promise the same dates", () => {
  it("delivery: past the cutoff, over the closed weekend, in the store's zone", async () => {
    await seed();
    const { quote, placed, order } = await quoteAndPlace();

    // Thu 15:00 is after the 14:00 cutoff, so counting starts Friday; +1 is Saturday (closed), so Sunday 30 August.
    // Sunday 00:00 in Cairo is Saturday 21:00 UTC.
    expect(quote.fulfilment?.dispatchBy.toISOString()).toBe("2026-08-29T21:00:00.000Z");
    expect(quote.fulfilment?.promisedWindow.to.toISOString()).toBe("2026-08-29T21:00:00.000Z");

    expect(order?.fulfilment.dispatchBy?.toISOString()).toBe(quote.fulfilment?.dispatchBy.toISOString());
    expect(order?.fulfilment.promisedWindow?.from.toISOString()).toBe(quote.fulfilment?.promisedWindow.from.toISOString());
    expect(order?.fulfilment.promisedWindow?.to.toISOString()).toBe(quote.fulfilment?.promisedWindow.to.toISOString());
    expect(placed.promisedWindow?.to.toISOString()).toBe(quote.fulfilment?.promisedWindow.to.toISOString());
  });

  it("an exception date moves both the same way", async () => {
    await seed({ exceptions: [{ date: new Date("2026-08-30T00:00:00Z"), closed: true, ranges: [] }] });
    const { quote, order } = await quoteAndPlace();

    // Sunday 30 August is a holiday: Monday 31 August 00:00 Cairo is Sunday 21:00 UTC.
    expect(quote.fulfilment?.dispatchBy.toISOString()).toBe("2026-08-30T21:00:00.000Z");
    expect(order?.fulfilment.dispatchBy?.toISOString()).toBe("2026-08-30T21:00:00.000Z");
    expect(order?.fulfilment.promisedWindow?.to.toISOString()).toBe(quote.fulfilment?.promisedWindow.to.toISOString());
  });

  it("pickup readiness respects the hours in both", async () => {
    await seed({ mode: "PICKUP" });
    const { quote, order } = await quoteAndPlace();

    expect(quote.fulfilment?.dispatchBy.toISOString()).toBe("2026-08-29T21:00:00.000Z");
    expect(order?.fulfilment.dispatchBy?.toISOString()).toBe(quote.fulfilment?.dispatchBy.toISOString());
  });

  it("both refuse when the promise would pass the booking window", async () => {
    await seed({ maxDaysAhead: 1 }); // the earliest date is Sunday: three days from Thursday
    await expect(generateQuote({ actor: { kind: "customer", customer }, locale: "en", now })).rejects.toThrow(/BEYOND_BOOKING_WINDOW/);
    await expect(placeOrderService({ customer, paymentMethod: "COD", termsVersionAccepted: 1, idempotencyKey: "k-window", locale: "en", now })).rejects.toThrow(/BEYOND_BOOKING_WINDOW/);
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("shipping days: both count 3–5 shipping days from the next shipping day, ignoring the store hours", async () => {
    // Store hours stay Sunday–Thursday 09:00–17:00 (seeded); shipping days are the same weekdays, but counted as business days.
    await seed({ shippingDays: [0, 1, 2, 3, 4], leadDaysMin: 3, leadDays: 5 });
    const { quote, order } = await quoteAndPlace();

    // Thu 15:00 is past the cutoff → Friday → the next shipping day is Sunday 30 August (day 0).
    // Dispatch Mon 31; window Wed 2 Sep (day 3) to Sun 6 Sep (day 5, skipping Fri/Sat). Cairo midnight is 21:00 UTC the day before.
    expect(quote.fulfilment?.dispatchBy.toISOString()).toBe("2026-08-30T21:00:00.000Z");
    expect(quote.fulfilment?.promisedWindow.from.toISOString()).toBe("2026-09-01T21:00:00.000Z");
    expect(quote.fulfilment?.promisedWindow.to.toISOString()).toBe("2026-09-05T21:00:00.000Z");

    expect(order?.fulfilment.dispatchBy?.toISOString()).toBe(quote.fulfilment?.dispatchBy.toISOString());
    expect(order?.fulfilment.promisedWindow?.from.toISOString()).toBe(quote.fulfilment?.promisedWindow.from.toISOString());
    expect(order?.fulfilment.promisedWindow?.to.toISOString()).toBe(quote.fulfilment?.promisedWindow.to.toISOString());
  });

  it("an order placed before shipping days were set keeps the promise it was given", async () => {
    await seed();
    const { order } = await quoteAndPlace();
    const saved = order?.fulfilment.promisedWindow;

    await FulfilmentSettingsModel.updateOne({}, { $set: { shippingDays: [0, 1, 2, 3, 4] } });
    await DeliveryZoneModel.updateOne({}, { $set: { leadDaysMin: 3, leadDays: 5 } });
    const reread = await OrderModel.findById(order?._id).lean();
    expect(reread?.fulfilment.promisedWindow).toEqual(saved);
  });

  it("the order's cancel deadline comes from the merchant's configured window", async () => {
    await seed();
    const { order } = await quoteAndPlace();
    expect(order?.customerCancelUntil?.toISOString()).toBe(new Date(now.getTime() + 30 * 60_000).toISOString());
  });
});

describe("the delivery estimate counts from confirmation", () => {
  const staffId = new mongoose.Types.ObjectId().toString();
  // Monday 31 August 2026, 10:00 in Cairo — before the 14:00 cutoff, a shipping day.
  const confirmedAt = new Date("2026-08-31T07:00:00Z");

  it("confirming a delivery order re-dates its promise from the confirmation, not the placement", async () => {
    await seed({ shippingDays: [0, 1, 2, 3, 4], leadDaysMin: 3, leadDays: 5 });
    const { order } = await quoteAndPlace();
    expect(order?.fulfilment.promiseFromConfirmation).toBe(true);
    // Provisional, from placement (Thu 15:00 → counts from Sunday): Wed 2 – Sun 6 Sep.
    expect(order?.fulfilment.promisedWindow?.from.toISOString()).toBe("2026-09-01T21:00:00.000Z");

    const confirmed = await transitionOrderStatus({ orderId: order!._id.toString(), to: "CONFIRMED", staffId, now: confirmedAt });
    // From Monday 31 Aug: dispatch Tue 1 Sep; window Thu 3 Sep (day 3) to Mon 7 Sep (day 5, skipping Fri/Sat).
    expect(confirmed.fulfilment.dispatchBy?.toISOString()).toBe("2026-08-31T21:00:00.000Z");
    expect(confirmed.fulfilment.promisedWindow?.from.toISOString()).toBe("2026-09-02T21:00:00.000Z");
    expect(confirmed.fulfilment.promisedWindow?.to.toISOString()).toBe("2026-09-06T21:00:00.000Z");
  });

  it("does not wait for a transfer: the re-dating happens at confirmation whatever the payment status", async () => {
    await seed({ shippingDays: [0, 1, 2, 3, 4], leadDaysMin: 3, leadDays: 5 });
    const { order } = await quoteAndPlace();
    await OrderModel.updateOne({ _id: order!._id }, { $set: { "payment.status": "AWAITING_PAYMENT" } });
    const confirmed = await transitionOrderStatus({ orderId: order!._id.toString(), to: "CONFIRMED", staffId, now: confirmedAt });
    expect(confirmed.payment.status).toBe("AWAITING_PAYMENT");
    expect(confirmed.fulfilment.promisedWindow?.from.toISOString()).toBe("2026-09-02T21:00:00.000Z");
  });

  it("never re-dates an order placed before the rule — its saved promise stands", async () => {
    await seed({ shippingDays: [0, 1, 2, 3, 4], leadDaysMin: 3, leadDays: 5 });
    const { order } = await quoteAndPlace();
    await OrderModel.updateOne({ _id: order!._id }, { $unset: { "fulfilment.promiseFromConfirmation": "" } });
    const saved = order?.fulfilment.promisedWindow;
    const confirmed = await transitionOrderStatus({ orderId: order!._id.toString(), to: "CONFIRMED", staffId, now: confirmedAt });
    expect(confirmed.fulfilment.promisedWindow).toEqual(saved);
  });

  it("confirms the order and keeps the provisional promise when its zone no longer exists", async () => {
    await seed({ shippingDays: [0, 1, 2, 3, 4], leadDaysMin: 3, leadDays: 5 });
    const { order } = await quoteAndPlace();
    await DeliveryZoneModel.deleteMany({});
    const confirmed = await transitionOrderStatus({ orderId: order!._id.toString(), to: "CONFIRMED", staffId, now: confirmedAt });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.fulfilment.promisedWindow).toEqual(order?.fulfilment.promisedWindow);
  });

  it("only confirmation re-dates: later status changes leave the promise alone", async () => {
    await seed({ shippingDays: [0, 1, 2, 3, 4], leadDaysMin: 3, leadDays: 5 });
    const { order } = await quoteAndPlace();
    const confirmed = await transitionOrderStatus({ orderId: order!._id.toString(), to: "CONFIRMED", staffId, now: confirmedAt });
    const processing = await transitionOrderStatus({ orderId: order!._id.toString(), to: "PROCESSING", staffId, now: new Date("2026-09-03T07:00:00Z") });
    expect(processing.fulfilment.promisedWindow).toEqual(confirmed.fulfilment.promisedWindow);
  });
});
