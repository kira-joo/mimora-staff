// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { StoreProfileModel } from "../../content/store-profile.schema";
import { STOREFRONT_GROUNDS } from "../../content/storefront-grounds";
import { MIN_CONTRAST_RATIO } from "../../engines/theme/derive-theme";
import { updateTheme } from "./update-theme";
import type { UpdateThemeDto } from "../dto/update-theme.dto";

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

function dto(overrides: Partial<UpdateThemeDto> = {}): UpdateThemeDto {
  return {
    brand: { primary: "#6B8F71", accent: "#B03060", surface: "#FFFFFF", text: "#111111", radiusScale: 1, typographyChoice: "default" },
    theme: { defaultGround: "light", darkEnabled: false, allowVisitorChoice: false, tokenOverrides: [] },
    ...overrides,
  } as UpdateThemeDto;
}

describe("updateTheme", () => {
  it("persists brand and theme exactly as submitted", async () => {
    const { profile } = await updateTheme(dto());

    expect(profile.brand.primary).toBe("#6B8F71");
    expect(profile.brand.surface).toBe("#FFFFFF");
    expect(profile.theme.defaultGround).toBe("light");

    const stored = await StoreProfileModel.findOne().lean();
    expect(stored?.brand.primary).toBe("#6B8F71");
  });

  it("reports the measured light-ground contrast ratio for a fill that already clears the bar", async () => {
    // #111111 on white clears WCAG AA comfortably — the derived ink should equal the seed itself.
    const { contrastReport } = await updateTheme(
      dto({ brand: { primary: "#111111", accent: "#111111", surface: "#FFFFFF", text: "#111111", radiusScale: 1, typographyChoice: "default" } })
    );

    const primary = contrastReport.lightGround.find((m) => m.label === "brand.primary");
    expect(primary?.meetsMinimum).toBe(true);
    expect(primary?.derivedInkHex).toBe("#111111");
    expect(primary?.contrastRatio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
  });

  it("MDS §20's own documented failure — #6B8F71 on white (3.63:1) — derives a compliant ink instead of storing the failing raw value as the measurement", async () => {
    const { contrastReport } = await updateTheme(
      dto({ brand: { primary: "#6B8F71", accent: "#111111", surface: "#FFFFFF", text: "#111111", radiusScale: 1, typographyChoice: "default" } })
    );

    const primary = contrastReport.lightGround.find((m) => m.label === "brand.primary");
    expect(primary?.fillHex).toBe("#6B8F71");
    expect(primary?.meetsMinimum).toBe(true);
    expect(primary?.contrastRatio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    // The derived ink moved away from the seed to clear the bar — it is not the raw, failing value.
    expect(primary?.derivedInkHex).not.toBe("#6B8F71");
  });

  it("measures every tokenOverrides[] value against the light ground too", async () => {
    const { contrastReport } = await updateTheme(
      dto({
        theme: {
          defaultGround: "light",
          darkEnabled: true,
          allowVisitorChoice: false,
          tokenOverrides: [{ key: "accent", value: "#B03060" }],
        },
      })
    );

    const override = contrastReport.lightGround.find((m) => m.label === "theme.tokenOverrides[accent]");
    expect(override?.fillHex).toBe("#B03060");
    expect(override?.meetsMinimum).toBe(true);
  });

  it("measures against the design system's grounds, never the merchant's free-text surface", async () => {
    const onWhite = await updateTheme(dto());
    const onBlack = await updateTheme(dto({ brand: { primary: "#6B8F71", accent: "#B03060", surface: "#000000", text: "#FFFFFF", radiusScale: 1, typographyChoice: "default" } }));

    expect(onWhite.contrastReport.lightGround.map((m) => m.groundHex)).toEqual([STOREFRONT_GROUNDS.light, STOREFRONT_GROUNDS.light]);
    expect(onBlack.contrastReport).toEqual(onWhite.contrastReport);
  });

  it("measures every fill on the dark ground too, and every value it reports is legible there", async () => {
    const { contrastReport } = await updateTheme(dto());
    expect(contrastReport.darkGround).toHaveLength(2);
    for (const measurement of contrastReport.darkGround) {
      expect(measurement.groundHex).toBe(STOREFRONT_GROUNDS.dark);
      expect(measurement.meetsMinimum).toBe(true);
      expect(measurement.contrastRatio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    }
  });

  it("reports an override that fails on one ground as falling back to the derived value there", async () => {
    const { contrastReport } = await updateTheme(dto({ theme: { defaultGround: "light", darkEnabled: true, allowVisitorChoice: false, tokenOverrides: [{ key: "primary", value: "#1A1A1A" }] } }));
    expect(contrastReport.lightGround.find((m) => m.label === "theme.tokenOverrides[primary]")).toMatchObject({ source: "override", derivedInkHex: "#1A1A1A" });
    expect(contrastReport.darkGround.find((m) => m.label === "theme.tokenOverrides[primary]")).toMatchObject({ source: "derived", meetsMinimum: true });
  });

  it("rejects a malformed hex loudly rather than silently deriving from it", async () => {
    await expect(
      updateTheme(dto({ brand: { primary: "not-a-color", accent: "#111111", surface: "#FFFFFF", text: "#111111", radiusScale: 1, typographyChoice: "default" } }))
    ).rejects.toThrow();
  });
});
