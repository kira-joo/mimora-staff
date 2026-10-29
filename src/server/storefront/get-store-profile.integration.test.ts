// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { StoreProfileModel } from "../content/store-profile.schema";
import { getStoreProfile } from "./get-store-profile";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await StoreProfileModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("getStoreProfile", () => {
  it("throws NotFoundError when the store has not been configured yet", async () => {
    await expect(getStoreProfile()).rejects.toThrow(/not configured/);
  });

  it("returns the configured profile, __v stripped by sanitizeLeanResult", async () => {
    await StoreProfileModel.create({
      name: { en: "Test Store", ar: "متجر تجريبي" },
      tagline: { en: "x", ar: "x" },
      description: { en: "x", ar: "x" },
      contact: { phone: "+201000000000", email: "store@example.com" },
      currency: "EGP",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
    });

    const profile = await getStoreProfile();
    expect(profile.name.en).toBe("Test Store");
    expect(profile.currency).toBe("EGP");
    expect(profile.contact.phone).toBe("+201000000000");
    // theme{} carries its own defaults even when the caller supplies none —
    // Phase 4A.5's rewrite, replacing the old bare `themeConfig` shape.
    expect(profile.theme.defaultGround).toBe("light");
    expect((profile as { __v?: unknown }).__v).toBeUndefined();
  });
});
