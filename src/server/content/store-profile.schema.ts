import { MongoField, MongoSchema, localizedStringField, imageAssetField, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * Store profile — identity, branding, contact, locales, default SEO.
 *
 * **Phase 4A.5 rewrite, not a Phase 2 amendment.** The version this replaces
 * carried `phone`/`email` as bare top-level fields, `tax{}` and
 * `shippingZones[]` embedded here, and `returnPolicy`/`privacyPolicy`/
 * `termsOfService` free-text fields — none of which are in MDS §8.1's
 * `StoreProfile` row, and its own doc comment still read "restaurant
 * platform architecture," i.e. this file was a copy, not authored for this
 * product (found during the pre-implementation architecture review).
 *
 * What moved out, and where:
 * - `tax{}` → `FulfilmentSettings.tax` (MDS places it there; this repo's own
 *   `fulfilment-settings.schema.ts` doc comment already disclosed the prior
 *   placement as a deviation).
 * - `shippingZones[]` → the standalone `DeliveryZone` collection (see
 *   `delivery-zone.schema.ts`) — a zone needs its own identity, a per-zone
 *   `minimumOrder`, and lifecycle (active/soft-delete) that an embedded
 *   array on a singleton document cannot carry.
 * - `phone`/`email` → `contact{}`, matching MDS's own grouping.
 * - `returnPolicy`/`privacyPolicy`/`termsOfService` → dropped. These are
 *   legal/content pages, not store identity — their correct home is the
 *   CMS `Page` entity (MDS §17), not a fixed field here. Not built in this
 *   phase (no routes are built in Phase 4A.5); noted so nobody re-adds them
 *   here by habit.
 */
@MongoSchema({ timestamps: true })
export class StoreProfileSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField(localizedStringField())
  name!: LocalizedString;

  @MongoField(localizedStringField())
  tagline!: LocalizedString;

  @MongoField(localizedStringField())
  description!: LocalizedString;

  @MongoField(imageAssetField())
  logo?: ImageAsset;

  @MongoField(imageAssetField())
  favicon?: ImageAsset;

  @MongoField(imageAssetField())
  ogImage?: ImageAsset;

  @MongoField(imageAssetField())
  heroMedia?: ImageAsset;

  /**
   * Raw brand identity (MDS §8.1 `brand{}`). `primary`/`accent` are the
   * seeds the storefront's brand colours are resolved from on both grounds
   * (`resolveBrandPalette`, against `STOREFRONT_GROUNDS`). `surface`/`text`
   * are stored but **not applied**: D-2 makes text and ground-dependent
   * surfaces non-overridable, and the storefront's grounds are the design
   * system's own (design-system.md §7a). Typography is not data: Mimora's
   * fonts are fixed in the storefront's code (the template's
   * `typographyChoice` was removed; a value stored before then is ignored).
   */
  @MongoField({
    type: new mongoose.Schema(
      {
        primary: { type: String, required: true },
        accent: { type: String, required: true },
        surface: { type: String, required: true },
        text: { type: String, required: true },
        radiusScale: { type: Number, required: true, default: 1 },
      },
      { _id: false }
    ),
    default: () => ({ primary: "#111111", accent: "#111111", surface: "#FFFFFF", text: "#111111", radiusScale: 1 }),
  })
  brand!: {
    primary: string;
    accent: string;
    surface: string;
    text: string;
    radiusScale: number;
  };

  /**
   * Theme switches plus the one place a brand fill may be overridden.
   *
   * `tokenOverrides[].key` is restricted to `"primary" | "accent"` at the
   * schema level — brand fills only, per `[ASSUMPTION → D-2]` in MDS §8.1
   * and the two recorded storefront failures in MDS §20 (an un-derived ink
   * that failed contrast on a second store; a ground-dependent surface
   * substituted at runtime). Write-time validation against both storefront
   * grounds, falling back to the derived value on failure, is
   * `resolveBrandPalette` (engines/theme), measured against
   * `STOREFRONT_GROUNDS`; this schema only fixes the storage shape.
   */
  @MongoField({
    type: new mongoose.Schema(
      {
        defaultGround: { type: String, enum: ["light", "dark"], default: "light" },
        darkEnabled: { type: Boolean, default: false },
        allowVisitorChoice: { type: Boolean, default: false },
        tokenOverrides: {
          type: [
            new mongoose.Schema(
              { key: { type: String, enum: ["primary", "accent"], required: true }, value: { type: String, required: true } },
              { _id: false }
            ),
          ],
          default: () => [],
        },
      },
      { _id: false }
    ),
    default: () => ({ defaultGround: "light", darkEnabled: false, allowVisitorChoice: false, tokenOverrides: [] }),
  })
  theme!: {
    defaultGround: "light" | "dark";
    darkEnabled: boolean;
    allowVisitorChoice: boolean;
    tokenOverrides: Array<{ key: "primary" | "accent"; value: string }>;
  };

  @MongoField({
    type: new mongoose.Schema(
      {
        phone: { type: String, required: true },
        email: { type: String, required: true },
        whatsApp: { type: String, required: false },
      },
      { _id: false }
    ),
    required: true,
  })
  contact!: { phone: string; email: string; whatsApp?: string };

  @MongoField({
    type: [new mongoose.Schema({ platform: { type: String, required: true }, url: { type: String, required: true } }, { _id: false })],
    default: () => [],
  })
  socialLinks!: Array<{ platform: string; url: string }>;

  @MongoField({ type: String, required: true })
  currency!: string;

  @MongoField({ type: String, enum: ["ar", "en"], default: "ar" })
  defaultLocale!: "ar" | "en";

  /** Defaults to `[defaultLocale]` at the application layer on create — not enforced here, since a schema-level default cannot reference a sibling field's value. */
  @MongoField({ type: [String], default: () => ["ar"] })
  supportedLocales!: string[];

  @MongoField({
    type: new mongoose.Schema(
      {
        title: { type: mongoose.Schema.Types.Mixed, required: false },
        description: { type: mongoose.Schema.Types.Mixed, required: false },
        ogImage: { type: new mongoose.Schema({ provider: String, publicId: String, secureUrl: String, format: String, width: Number, height: Number, bytes: Number, version: Number, placeholderUrl: String }, { _id: false }), required: false },
      },
      { _id: false }
    ),
    default: () => ({}),
  })
  defaultSeo!: { title?: LocalizedString; description?: LocalizedString; ogImage?: ImageAsset };
}

export const StoreProfileModel = createMongoModel("StoreProfile", StoreProfileSchema);
