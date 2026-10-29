// @vitest-environment node
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { deliveryZoneRepository } from "../core/repositories";
import { DeliveryZoneModel } from "../fulfilment/delivery-zone.schema";
import { PickupLocationModel } from "../fulfilment/pickup-location.schema";
import { getDeliveryZones } from "./get-delivery-zones";
import { getPickupLocations } from "./get-pickup-locations";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

// Before as well as after: these tests assume an empty collection, so they must not depend on every other suite cleaning up.
beforeEach(async () => {
  await Promise.all([DeliveryZoneModel.deleteMany({}), PickupLocationModel.deleteMany({})]);
});

afterEach(async () => {
  await Promise.all([DeliveryZoneModel.deleteMany({}), PickupLocationModel.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("getDeliveryZones", () => {
  it("returns only active zones, in order", async () => {
    await DeliveryZoneModel.create([
      { name: { en: "B", ar: "ب" }, fee: toMoney("10.00"), minimumOrder: toMoney("0.00"), leadDays: 1, active: true, order: 1 },
      { name: { en: "A", ar: "أ" }, fee: toMoney("5.00"), minimumOrder: toMoney("0.00"), leadDays: 1, active: true, order: 0 },
      { name: { en: "Off", ar: "إيقاف" }, fee: toMoney("1.00"), minimumOrder: toMoney("0.00"), leadDays: 1, active: false, order: -1 },
    ]);

    const zones = await getDeliveryZones();
    expect(zones.map((z) => z.name.en)).toEqual(["A", "B"]); // "Off" excluded, ordered by `order`
  });

  it("excludes a soft-deleted zone — the exact bug this getter was rewritten to avoid using the repository instead of the raw model", async () => {
    const zone = await DeliveryZoneModel.create({ name: { en: "X", ar: "x" }, fee: toMoney("1.00"), minimumOrder: toMoney("0.00"), leadDays: 1, active: true });
    await deliveryZoneRepository.softDelete({ where: { _id: zone._id } });

    expect(await getDeliveryZones()).toEqual([]);
  });
});

describe("getPickupLocations", () => {
  it("returns only active locations", async () => {
    await PickupLocationModel.create([
      { name: { en: "Main", ar: "الرئيسي" }, address: { en: "1 St", ar: "شارع 1" }, phone: "+201000000000", active: true, order: 0 },
      { name: { en: "Closed", ar: "مغلق" }, address: { en: "2 St", ar: "شارع 2" }, phone: "+201000000001", active: false, order: 1 },
    ]);

    const locations = await getPickupLocations();
    expect(locations.map((l) => l.name.en)).toEqual(["Main"]);
  });
});
