import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { DeliveryZoneModel } from "src/server/fulfilment/delivery-zone.schema";
import { FulfilmentSettingsModel } from "src/server/fulfilment/fulfilment-settings.schema";
import { PickupLocationModel } from "src/server/fulfilment/pickup-location.schema";
import { removeHarnessStaff, signInAsOwner, type AdminCaller, type RouteHandler } from "./test-support/admin-route-harness";

/**
 * Route-level: optional fulfilment values can be set, changed, cleared with
 * `null`, and are left alone when omitted. Each cleared field is removed —
 * not stored as null — so the absence its engine documents applies.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("./test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const createZone = (await import("./delivery-zones/route")).POST as RouteHandler;
const updateZone = (await import("./delivery-zones/[id]/route")).PUT as RouteHandler;
const createPickup = (await import("./pickup-locations/route")).POST as RouteHandler;
const updatePickup = (await import("./pickup-locations/[id]/route")).PUT as RouteHandler;
const updateSettings = (await import("./fulfilment-settings/route")).PUT as RouteHandler;

let admin: AdminCaller;

async function send(handler: RouteHandler, path: string, method: "POST" | "PUT", body: unknown, id?: string) {
  const response = await admin.call(handler, path, { method, body, params: id ? { id } : {} });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

const rawZone = (id: string) => DeliveryZoneModel.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
const rawPickup = (id: string) => PickupLocationModel.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
const rawSettings = () => FulfilmentSettingsModel.collection.findOne({});

beforeAll(async () => {
  await connectToDatabase();
  admin = await signInAsOwner();
});

afterAll(async () => {
  await Promise.all([removeHarnessStaff(), DeliveryZoneModel.deleteMany({}), PickupLocationModel.deleteMany({}), FulfilmentSettingsModel.deleteMany({})]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([DeliveryZoneModel.deleteMany({}), PickupLocationModel.deleteMany({}), FulfilmentSettingsModel.deleteMany({})]);
});

describe("delivery zone minimumOrder", () => {
  const zone = { name: { en: "Maadi", ar: "المعادي" }, areas: ["Maadi"], fee: "30", leadDays: 1 };

  it("is absent unless set — the store-wide minimum then applies", async () => {
    const { status, body } = await send(createZone, "/api/admin/delivery-zones", "POST", zone);
    expect(status).toBe(201);
    expect(await rawZone(body._id)).not.toHaveProperty("minimumOrder");
  });

  it("can be set, changed, left alone, and cleared", async () => {
    const { body } = await send(createZone, "/api/admin/delivery-zones", "POST", { ...zone, minimumOrder: "100" });
    expect((await rawZone(body._id))?.minimumOrder.toString()).toBe("100.00");

    await send(updateZone, `/api/admin/delivery-zones/${body._id}`, "PUT", { minimumOrder: "150" }, body._id);
    expect((await rawZone(body._id))?.minimumOrder.toString()).toBe("150.00");

    await send(updateZone, `/api/admin/delivery-zones/${body._id}`, "PUT", { fee: "35" }, body._id);
    const afterOmit = await rawZone(body._id);
    expect(afterOmit?.minimumOrder.toString()).toBe("150.00");
    expect(afterOmit?.fee.toString()).toBe("35.00");

    const cleared = await send(updateZone, `/api/admin/delivery-zones/${body._id}`, "PUT", { minimumOrder: null }, body._id);
    expect(cleared.status).toBe(200);
    expect(await rawZone(body._id)).not.toHaveProperty("minimumOrder");
  });

  it("keeps zero as a value — a zone with explicitly no minimum", async () => {
    const { body } = await send(createZone, "/api/admin/delivery-zones", "POST", { ...zone, minimumOrder: "0" });
    expect((await rawZone(body._id))?.minimumOrder.toString()).toBe("0.00");
  });

  it("still validates a value, and refuses to clear the required fee", async () => {
    const { body } = await send(createZone, "/api/admin/delivery-zones", "POST", zone);
    expect((await send(updateZone, `/api/admin/delivery-zones/${body._id}`, "PUT", { minimumOrder: "abc" }, body._id)).status).toBe(400);
    expect((await send(updateZone, `/api/admin/delivery-zones/${body._id}`, "PUT", { fee: null }, body._id)).status).toBe(400);
    expect((await rawZone(body._id))?.fee.toString()).toBe("30.00");
  });
});

describe("fulfilment settings orderMinimum, flatShippingFee, cutoffTime", () => {
  it("can be set, changed, left alone, and cleared one at a time", async () => {
    expect((await send(updateSettings, "/api/admin/fulfilment-settings", "PUT", { orderMinimum: "200", flatShippingFee: "40", cutoffTime: "18:00" })).status).toBe(200);
    let stored = await rawSettings();
    expect(stored?.orderMinimum.toString()).toBe("200.00");
    expect(stored?.flatShippingFee.toString()).toBe("40.00");
    expect(stored?.cutoffTime).toBe("18:00");

    await send(updateSettings, "/api/admin/fulfilment-settings", "PUT", { cutoffTime: "20:30" });
    stored = await rawSettings();
    expect(stored?.cutoffTime).toBe("20:30");
    expect(stored?.orderMinimum.toString()).toBe("200.00");

    await send(updateSettings, "/api/admin/fulfilment-settings", "PUT", { orderMinimum: null });
    stored = await rawSettings();
    expect(stored).not.toHaveProperty("orderMinimum");
    expect(stored?.flatShippingFee.toString()).toBe("40.00");

    await send(updateSettings, "/api/admin/fulfilment-settings", "PUT", { flatShippingFee: null, cutoffTime: null });
    stored = await rawSettings();
    expect(stored).not.toHaveProperty("flatShippingFee");
    expect(stored).not.toHaveProperty("cutoffTime");
  });

  it("still validates a value, and refuses to clear a required setting", async () => {
    expect((await send(updateSettings, "/api/admin/fulfilment-settings", "PUT", { cutoffTime: "25:00" })).status).toBe(400);
    expect((await send(updateSettings, "/api/admin/fulfilment-settings", "PUT", { maxDaysAhead: null })).status).toBe(400);
  });
});

describe("pickup location coordinates", () => {
  const location = { name: { en: "Zamalek", ar: "الزمالك" }, address: { en: "26th of July St", ar: "شارع ٢٦ يوليو" }, phone: "+201000000000" };

  it("can be set, changed, left alone, and cleared", async () => {
    const { status, body } = await send(createPickup, "/api/admin/pickup-locations", "POST", { ...location, coordinates: { lat: 30.06, lng: 31.22 } });
    expect(status).toBe(201);

    await send(updatePickup, `/api/admin/pickup-locations/${body._id}`, "PUT", { coordinates: { lat: 30.07, lng: 31.23 } }, body._id);
    expect((await rawPickup(body._id))?.coordinates).toEqual({ lat: 30.07, lng: 31.23 });

    await send(updatePickup, `/api/admin/pickup-locations/${body._id}`, "PUT", { phone: "+201111111111" }, body._id);
    expect((await rawPickup(body._id))?.coordinates).toEqual({ lat: 30.07, lng: 31.23 });

    expect((await send(updatePickup, `/api/admin/pickup-locations/${body._id}`, "PUT", { coordinates: null }, body._id)).status).toBe(200);
    expect(await rawPickup(body._id)).not.toHaveProperty("coordinates");
  });

  it("still validates coordinates when given (numbers — the DTO has no range check)", async () => {
    const { body } = await send(createPickup, "/api/admin/pickup-locations", "POST", location);
    expect((await send(updatePickup, `/api/admin/pickup-locations/${body._id}`, "PUT", { coordinates: { lat: "north", lng: 31 } }, body._id)).status).toBe(400);
  });
});
