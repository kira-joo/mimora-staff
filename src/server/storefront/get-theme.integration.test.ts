// @vitest-environment node
import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { StoreProfileModel } from "../content/store-profile.schema";
import { STOREFRONT_GROUNDS } from "../content/storefront-grounds";
import { MIN_CONTRAST_RATIO } from "../engines/theme/derive-theme";
import { getTheme } from "./get-theme";

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

describe("getTheme", () => {
  it("throws NotFoundError when no store profile is configured", async () => {
    await expect(getTheme()).rejects.toThrow(NotFoundError);
  });

  it("returns brand + theme as stored, plus the palette resolved on both approved grounds", async () => {
    await StoreProfileModel.create({
      name: { en: "T", ar: "ت" },
      tagline: { en: "x", ar: "x" },
      description: { en: "x", ar: "x" },
      contact: { phone: "+201000000000", email: "s@example.com" },
      currency: "EGP",
      brand: { primary: "#6B8F71", accent: "#654321", surface: "#FFFFFF", text: "#000000", radiusScale: 2, typographyChoice: "contemporary" },
      theme: { defaultGround: "light", darkEnabled: true, allowVisitorChoice: true, tokenOverrides: [{ key: "primary", value: "#ABCDEF" }] },
    });

    const theme = await getTheme();
    expect(theme.brand.primary).toBe("#6B8F71");
    expect(theme.brand.typographyChoice).toBe("contemporary");
    expect(theme.theme.darkEnabled).toBe(true);
    expect(theme.theme.tokenOverrides).toEqual([{ key: "primary", value: "#ABCDEF" }]);
    expect(theme.grounds).toEqual(STOREFRONT_GROUNDS);
    expect(Object.keys(theme).sort()).toEqual(["brand", "grounds", "palette", "theme"]);

    // #ABCDEF is too light for the light ground — the derived primary is used there instead; on dark it passes as pinned.
    expect(theme.palette.light.primary.source).toBe("derived");
    expect(theme.palette.dark.primary).toMatchObject({ hex: "#ABCDEF", source: "override" });
    for (const ground of ["light", "dark"] as const) {
      for (const key of ["primary", "accent"] as const) expect(theme.palette[ground][key].contrastRatio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    }
  });

  it("reads a typography value outside the curated set as the default pairing (D-S4)", async () => {
    await StoreProfileModel.create({
      name: { en: "T", ar: "ت" },
      tagline: { en: "x", ar: "x" },
      description: { en: "x", ar: "x" },
      contact: { phone: "+201000000000", email: "s@example.com" },
      currency: "EGP",
      brand: { primary: "#123456", accent: "#654321", surface: "#FFFFFF", text: "#000000", radiusScale: 1, typographyChoice: "rounded" },
      theme: { defaultGround: "light", darkEnabled: false, allowVisitorChoice: false, tokenOverrides: [] },
    });
    expect((await getTheme()).brand.typographyChoice).toBe("default");
  });
});
