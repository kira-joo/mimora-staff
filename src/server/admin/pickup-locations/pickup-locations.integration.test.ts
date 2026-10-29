import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { PickupLocationModel } from "../../fulfilment/pickup-location.schema";
import { listPickupLocations } from "./list-pickup-locations";
import { reorderPickupLocations } from "./reorder-pickup-locations";
import { pickupLocationRepository } from "../../core/repositories";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const LOCALIZED = { ar: "نص", en: "Text" };

describe("Admin Pickup Locations", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await PickupLocationModel.deleteMany({});
  });

  afterEach(async () => {
    await PickupLocationModel.deleteMany({});
  });

  describe("createPickupLocation", () => {
    it("creates a location with defaults", async () => {
      const location = await pickupLocationRepository.save({ name: LOCALIZED, address: LOCALIZED, phone: "+201000000000" });
      expect(location.active).toBe(true);
      expect(location.order).toBe(0);
      expect(location.coordinates).toBeUndefined();
    });

    it("creates a location with coordinates", async () => {
      const location = await pickupLocationRepository.save({ name: LOCALIZED, address: LOCALIZED, phone: "+201000000000", coordinates: { lat: 30.0, lng: 31.2 } });
      expect(location.coordinates?.lat).toBe(30.0);
    });
  });

  describe("update", () => {
    it("updates fields and deactivates", async () => {
      const created = await pickupLocationRepository.save({ name: LOCALIZED, address: LOCALIZED, phone: "+201000000000" });
      const updated = await pickupLocationRepository.update(
        { where: { _id: created._id.toString() } },
        // A DTO-shaped patch: absent fields arrive as `undefined` and must leave the stored value untouched.
        { name: undefined, address: undefined, active: false, phone: "+201111111111" }
      );
      expect(updated.active).toBe(false);
      expect(updated.phone).toBe("+201111111111");
      expect(updated.name.en).toBe(LOCALIZED.en);
      expect(updated.address.en).toBe(LOCALIZED.en);
    });
  });

  describe("listPickupLocations", () => {
    it("filters by active and sorts by order", async () => {
      await pickupLocationRepository.save({ name: LOCALIZED, address: LOCALIZED, phone: "1", order: 2, active: true });
      await pickupLocationRepository.save({ name: LOCALIZED, address: LOCALIZED, phone: "2", order: 1, active: false });

      const active = await listPickupLocations({ limit: 10, page: 1, active: true });
      expect(active.total).toBe(1);

      const all = await listPickupLocations({ limit: 10, page: 1 });
      expect(all.data[0]?.order).toBe(1);
    });
  });

  describe("reorderPickupLocations", () => {
    it("bulk-updates order", async () => {
      const a = await pickupLocationRepository.save({ name: LOCALIZED, address: LOCALIZED, phone: "1" });
      const b = await pickupLocationRepository.save({ name: LOCALIZED, address: LOCALIZED, phone: "2" });

      await reorderPickupLocations({ items: [{ locationId: a._id.toString(), order: 2 }, { locationId: b._id.toString(), order: 1 }] });

      const updatedA = await PickupLocationModel.findById(a._id).lean();
      const updatedB = await PickupLocationModel.findById(b._id).lean();
      expect(updatedA?.order).toBe(2);
      expect(updatedB?.order).toBe(1);
    });
  });
});
