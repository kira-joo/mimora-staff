import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { InventorySettingsModel } from "../../fulfilment/inventory-settings.schema";
import { PaymentSettingsModel } from "../../fulfilment/payment-settings.schema";
import { NotificationSettingsModel } from "../../fulfilment/notification-settings.schema";
import { OperatingHoursModel } from "../../fulfilment/operating-hours.schema";
import { StoreProfileModel } from "../../content/store-profile.schema";
import { getSingletonSettings, upsertSingletonSettings } from "./singleton-settings";
import {
  inventorySettingsRepository,
  notificationSettingsRepository,
  operatingHoursRepository,
  paymentSettingsRepository,
  storeProfileRepository,
} from "../../core/repositories";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const MODELS = [InventorySettingsModel, PaymentSettingsModel, NotificationSettingsModel, OperatingHoursModel, StoreProfileModel];

describe("Admin Settings — singleton-settings helper", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all(MODELS.map((m) => m.deleteMany()));
  });

  afterEach(async () => {
    await Promise.all(MODELS.map((m) => m.deleteMany()));
  });

  describe("getSingletonSettings", () => {
    it("returns schema defaults without persisting when nothing is saved (InventorySettings)", async () => {
      const settings = await getSingletonSettings(inventorySettingsRepository);
      expect(settings.lowStockThreshold).toBe(5);
      expect(settings.defaultInventoryPolicy).toBe("DENY");
      expect(await InventorySettingsModel.countDocuments()).toBe(0);
    });

    it("returns the saved singleton once one exists", async () => {
      await InventorySettingsModel.create({ lowStockThreshold: 10 });
      const settings = await getSingletonSettings(inventorySettingsRepository);
      expect(settings.lowStockThreshold).toBe(10);
    });
  });

  describe("upsertSingletonSettings", () => {
    it("creates the singleton on first update and never a second document", async () => {
      await upsertSingletonSettings(inventorySettingsRepository, { lowStockThreshold: 3 });
      const settings = await upsertSingletonSettings(inventorySettingsRepository, { defaultInventoryPolicy: "CONTINUE_SELLING" });

      expect(settings.lowStockThreshold).toBe(3); // untouched by the second call
      expect(settings.defaultInventoryPolicy).toBe("CONTINUE_SELLING");
      expect(await InventorySettingsModel.countDocuments()).toBe(1);
    });

    it("replaces array-shaped settings wholesale (PaymentSettings.methods)", async () => {
      await upsertSingletonSettings(paymentSettingsRepository, {
        methods: [{ method: "COD", enabled: true, order: 0, requiresProof: false, requiresProviderIntegration: false }],
      });

      const settings = await upsertSingletonSettings(paymentSettingsRepository, {
        methods: [{ method: "WALLET_TRANSFER", enabled: true, order: 0, requiresProof: true, requiresProviderIntegration: false }],
      });

      expect(settings.methods).toHaveLength(1);
      expect(settings.methods[0]?.method).toBe("WALLET_TRANSFER");
    });

    it("replaces NotificationSettings.events wholesale", async () => {
      const settings = await upsertSingletonSettings(notificationSettingsRepository, {
        events: [{ event: "ORDER_PLACED", channels: ["EMAIL"], recipientRoles: ["owner"] }],
      });
      expect(settings.events[0]?.channels).toEqual(["EMAIL"]);
    });

    it("saves OperatingHours weekly and exceptions", async () => {
      const settings = await upsertSingletonSettings(operatingHoursRepository, {
        weekly: [{ weekday: 0, ranges: [{ open: "09:00", close: "22:00" }] }],
        exceptions: [{ date: new Date(2026, 0, 1), closed: true, ranges: [] }],
      });
      expect(settings.weekly).toHaveLength(1);
      expect(settings.exceptions[0]?.closed).toBe(true);
    });

    it("a partial first save on StoreProfile leaves its other required-with-no-default fields absent, same as every other singleton", async () => {
      const settings = await upsertSingletonSettings(storeProfileRepository, { name: { ar: "متجر", en: "Store" } });
      expect(settings.name.en).toBe("Store");
      expect((settings as { contact?: unknown }).contact).toBeUndefined();
      expect((settings as { currency?: unknown }).currency).toBeUndefined();
    });

    it("allows a partial StoreProfile update once the required fields are already set", async () => {
      await StoreProfileModel.create({
        name: { ar: "متجر", en: "Store" },
        tagline: { ar: "", en: "" },
        description: { ar: "", en: "" },
        contact: { phone: "+201000000000", email: "shop@example.com" },
        currency: "EGP",
      });

      const updated = await upsertSingletonSettings(storeProfileRepository, { tagline: { ar: "أفضل", en: "The best" } });
      expect(updated.tagline.en).toBe("The best");
      expect(updated.currency).toBe("EGP"); // untouched
    });
  });
});
