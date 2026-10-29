import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { DeliveryZoneModel } from "../../fulfilment/delivery-zone.schema";
import { deliveryZoneRepository } from "../../core/repositories";
import { listDeliveryZones } from "./list-delivery-zones";
import { reorderDeliveryZones } from "./reorder-delivery-zones";
import { NotFoundError } from "@kira-joo/backend-toolkit-core";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const LOCALIZED = { ar: "منطقة", en: "Zone" };

describe("Admin Delivery Zones", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await DeliveryZoneModel.deleteMany({});
  });

  afterEach(async () => {
    await DeliveryZoneModel.deleteMany({});
  });

  describe("createDeliveryZone", () => {
    it("creates a zone with defaults", async () => {
      const zone = await deliveryZoneRepository.save({ name: LOCALIZED, fee: toMoney("20.00") });
      expect(zone.fee.toFixed(2)).toBe("20.00");
      expect(zone.leadDays).toBe(1);
      expect(zone.active).toBe(true);
      expect(zone.areas).toEqual([]);
    });
  });

  describe("Money wire format", () => {
    it("create, update and list responses serialize Money identically — plain decimals, never BSON extended JSON", async () => {
      const created = await deliveryZoneRepository.save({ name: LOCALIZED, fee: toMoney("20.00") });
      const updated = await deliveryZoneRepository.update({ where: { _id: created._id.toString() } }, { minimumOrder: toMoney("5.50") });
      const listed = await deliveryZoneRepository.findAllAndCountPublic({ where: { _id: created._id } });

      const wire = (value: unknown) => JSON.parse(JSON.stringify(value)) as { fee: unknown; minimumOrder: unknown };
      expect(JSON.stringify([created, updated])).not.toContain("$numberDecimal");
      expect(wire(created).fee).toBe("20");
      expect([wire(updated).fee, wire(updated).minimumOrder]).toEqual([wire(listed.data[0]).fee, wire(listed.data[0]).minimumOrder]);
    });
  });

  describe("update", () => {
    it("updates fee and areas", async () => {
      const created = await deliveryZoneRepository.save({ name: LOCALIZED, fee: toMoney("20.00") });
      const updated = await deliveryZoneRepository.update(
        { where: { _id: created._id.toString() } },
        // A DTO-shaped patch: absent fields arrive as `undefined` and must leave the stored value untouched.
        { name: undefined, fee: toMoney("30.00"), areas: ["Maadi", "Zamalek"], leadDays: undefined }
      );
      expect(updated.fee.toFixed(2)).toBe("30.00");
      expect(updated.areas).toEqual(["Maadi", "Zamalek"]);
      expect(updated.name.en).toBe(LOCALIZED.en);
      expect(updated.leadDays).toBe(1);
    });
  });

  describe("listDeliveryZones", () => {
    it("filters by active and sorts by order", async () => {
      await deliveryZoneRepository.save({ name: LOCALIZED, fee: toMoney("10.00"), order: 2, active: true });
      await deliveryZoneRepository.save({ name: LOCALIZED, fee: toMoney("10.00"), order: 1, active: false });

      const active = await listDeliveryZones({ limit: 10, page: 1, active: true });
      expect(active.total).toBe(1);

      const all = await listDeliveryZones({ limit: 10, page: 1 });
      expect(all.data[0]?.order).toBe(1);
    });
  });

  describe("reorderDeliveryZones", () => {
    it("bulk-updates order", async () => {
      const a = await deliveryZoneRepository.save({ name: LOCALIZED, fee: toMoney("10.00") });
      const b = await deliveryZoneRepository.save({ name: LOCALIZED, fee: toMoney("10.00") });

      await reorderDeliveryZones({ items: [{ zoneId: a._id.toString(), order: 2 }, { zoneId: b._id.toString(), order: 1 }] });

      const updatedA = await DeliveryZoneModel.findById(a._id).lean();
      const updatedB = await DeliveryZoneModel.findById(b._id).lean();
      expect(updatedA?.order).toBe(2);
      expect(updatedB?.order).toBe(1);
    });
  });

  describe("soft delete", () => {
    it("hides a soft-deleted zone from normal reads", async () => {
      const created = await deliveryZoneRepository.save({ name: LOCALIZED, fee: toMoney("10.00") });
      await deliveryZoneRepository.softDelete({ where: { _id: created._id.toString() } });

      await expect(deliveryZoneRepository.findOne({ where: { _id: created._id.toString() } })).rejects.toThrow(NotFoundError);
    });
  });
});
