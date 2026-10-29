import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { FulfilmentSettingsModel } from "../../fulfilment/fulfilment-settings.schema";
import { fulfilmentSettingsRepository } from "../../core/repositories";
import { getSingletonSettings, upsertSingletonSettings } from "./singleton-settings";

const getFulfilmentSettings = () => getSingletonSettings(fulfilmentSettingsRepository);
const updateFulfilmentSettings = (patch: Record<string, unknown>) =>
  upsertSingletonSettings(fulfilmentSettingsRepository, patch);

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

describe("Admin Fulfilment Settings", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await FulfilmentSettingsModel.deleteMany({});
  });

  afterEach(async () => {
    await FulfilmentSettingsModel.deleteMany({});
  });

  describe("getFulfilmentSettings", () => {
    it("returns schema defaults without persisting when nothing is saved yet", async () => {
      const settings = await getFulfilmentSettings();
      expect(settings.deliveryEnabled).toBe(true);
      expect(settings.pickupEnabled).toBe(false);
      expect(settings.returnWindowDays).toBe(14);

      const count = await FulfilmentSettingsModel.countDocuments();
      expect(count).toBe(0); // no side effect
    });

    it("returns the saved singleton once one exists", async () => {
      await FulfilmentSettingsModel.create({ deliveryEnabled: false });
      const settings = await getFulfilmentSettings();
      expect(settings.deliveryEnabled).toBe(false);
    });
  });

  describe("updateFulfilmentSettings", () => {
    it("creates the singleton on first update", async () => {
      const settings = await updateFulfilmentSettings({ pickupEnabled: true, orderMinimum: toMoney("50.00") });
      expect(settings.pickupEnabled).toBe(true);
      expect(settings.orderMinimum?.toFixed(2)).toBe("50.00");
      // The response must carry Money as a plain decimal, never BSON extended JSON.
      expect(JSON.stringify(settings)).toContain('"orderMinimum":"50"');

      const count = await FulfilmentSettingsModel.countDocuments();
      expect(count).toBe(1);
    });

    it("updates only the provided fields on subsequent calls", async () => {
      await updateFulfilmentSettings({ pickupEnabled: true, deliveryEnabled: true });
      const settings = await updateFulfilmentSettings({ pickupEnabled: false });

      expect(settings.pickupEnabled).toBe(false);
      expect(settings.deliveryEnabled).toBe(true); // untouched

      const count = await FulfilmentSettingsModel.countDocuments();
      expect(count).toBe(1); // still one singleton, not a second doc
    });

    it("allows both delivery and pickup disabled at once — a first-class state per MDS §16", async () => {
      const settings = await updateFulfilmentSettings({ deliveryEnabled: false, pickupEnabled: false });
      expect(settings.deliveryEnabled).toBe(false);
      expect(settings.pickupEnabled).toBe(false);
    });
  });
});
