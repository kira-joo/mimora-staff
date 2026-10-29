// @vitest-environment node
import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { FulfilmentSettingsModel } from "../fulfilment/fulfilment-settings.schema";
import { OperatingHoursModel } from "../fulfilment/operating-hours.schema";
import { PaymentSettingsModel } from "../fulfilment/payment-settings.schema";
import { getFulfilmentSettings } from "./get-fulfilment-settings";
import { getOperatingHours } from "./get-operating-hours";
import { getPaymentMethods } from "./get-payment-methods";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

// Before as well as after: these tests assume an empty collection, so they must not depend on every other suite cleaning up.
beforeEach(async () => {
  await Promise.all([FulfilmentSettingsModel.deleteMany({}), PaymentSettingsModel.deleteMany({}), OperatingHoursModel.deleteMany({})]);
});

afterEach(async () => {
  await Promise.all([FulfilmentSettingsModel.deleteMany({}), PaymentSettingsModel.deleteMany({}), OperatingHoursModel.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("getFulfilmentSettings", () => {
  it("throws NotFoundError when unconfigured", async () => {
    await expect(getFulfilmentSettings()).rejects.toThrow(NotFoundError);
  });

  it("returns the singleton, tax rate included", async () => {
    await FulfilmentSettingsModel.create({ tax: { mode: "ADDED", rate: 14 } });
    const settings = await getFulfilmentSettings();
    expect(settings.tax.rate).toBe(14);
  });
});

describe("getPaymentMethods — display fields only", () => {
  it("returns an empty array when unconfigured — never a 404 for a plural resource", async () => {
    expect(await getPaymentMethods()).toEqual([]);
  });

  it("excludes disabled methods entirely, and sorts by order", async () => {
    await PaymentSettingsModel.create({
      methods: [
        { method: "COD", enabled: true, order: 1, requiresProof: false, requiresProviderIntegration: false },
        { method: "WALLET_TRANSFER", enabled: false, order: 0, requiresProof: true, requiresProviderIntegration: false },
        { method: "INSTAPAY_TRANSFER", enabled: true, order: 0, requiresProof: true, requiresProviderIntegration: false, destination: { handle: "01000000000" } },
      ],
    });

    const methods = await getPaymentMethods();
    expect(methods.map((m) => m.method)).toEqual(["INSTAPAY_TRANSFER", "COD"]); // order 0 before 1; WALLET_TRANSFER (disabled) excluded
  });

  it("strips internal-only fields — requiresProviderIntegration/autoCancelMinutes/verificationWindowMinutes never leave this function", async () => {
    await PaymentSettingsModel.create({
      methods: [
        {
          method: "INSTAPAY_TRANSFER",
          enabled: true,
          order: 0,
          requiresProof: true,
          requiresProviderIntegration: false,
          autoCancelMinutes: 30,
          verificationWindowMinutes: 60,
          destination: { handle: "01000000000" },
        },
      ],
    });

    const [method] = await getPaymentMethods();
    expect(method).toEqual({
      method: "INSTAPAY_TRANSFER",
      order: 0,
      instructions: undefined,
      destination: { handle: "01000000000" },
      requiresProof: true,
    });
    expect(method).not.toHaveProperty("requiresProviderIntegration");
    expect(method).not.toHaveProperty("autoCancelMinutes");
    expect(method).not.toHaveProperty("verificationWindowMinutes");
  });
});

describe("getOperatingHours", () => {
  it("returns an empty schedule when unconfigured, not an error", async () => {
    expect(await getOperatingHours()).toEqual({ weekly: [], exceptions: [] });
  });

  it("returns the configured weekly schedule and exceptions", async () => {
    await OperatingHoursModel.create({
      weekly: [{ weekday: 0, ranges: [{ open: "09:00", close: "22:00" }] }],
      exceptions: [{ date: new Date(2026, 0, 1), closed: true, ranges: [] }],
    });

    const hours = await getOperatingHours();
    expect(hours.weekly).toHaveLength(1);
    expect(hours.exceptions[0]?.closed).toBe(true);
  });
});
