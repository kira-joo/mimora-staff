import {
  MongoField,
  MongoSchema,
  Relation,
  Searchable,
  Filterable,
  Unique,
  localizedStringField,
  localizedStringSchema,
  imageAssetField,
  moneyField,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, ImageAsset, Money } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * Product — merchandising and content only. No price, no stock.
 *
 * Per Phase 2 requirements: a variant owns price and stock absolutely.
 * Products carry merchandising, localized content, option axes, facets, SEO.
 *
 * Lifecycle: draft → published → archived (not a boolean active).
 *
 * **Phase 4A.5 rewrite.** The pre-implementation architecture review found
 * this schema materially short of both MDS §8.2 and what a sellable catalog
 * product needs: only a boolean `hasStock` where MDS specifies a `listing{}`
 * rollup, no `sizeGuide`/`publishAt`/`order`, and `facetAttributes` as a
 * loose `Record<string,string>` instead of a real, filterable structure.
 * Added in this pass:
 *
 * - `listing{}` — the materialised rollup MDS §12 requires, maintained
 *   transactionally by `catalog/rollups/maintain-product-listing.ts` on
 *   every variant write that can change it (create/delete, active/discontinued
 *   change, price change, stock crossing zero). `hasStock: boolean` is
 *   removed — `listing.purchasableVariantCount > 0` is now the correctness
 *   claim `hasStock` used to make, materialised as a count instead of a
 *   boolean because (MDS §12) "a boolean cannot be maintained correctly
 *   under concurrent writes."
 * - `ratingsSummary{}` — genuinely new, not in MDS. Same materialised-rollup
 *   discipline as `listing{}`, maintained by
 *   `content/rollups/maintain-ratings-summary.ts` whenever a `Review`
 *   crosses the approved/non-approved boundary. Justified because without
 *   it, every product-list render either aggregates `Review` live (a
 *   storefront-performance cost) or shows no rating signal at all.
 * - `sizeGuide?`, `publishAt?`, `order` — present in MDS §8.2, absent from
 *   the prior schema.
 * - `attributes[]` — replaces `facetAttributes: Record<string,string>` with
 *   a structured, per-value array so a facet aggregation pipeline (Phase 4B)
 *   can actually filter on it; a `Record` cannot be indexed or
 *   `@Filterable()`-declared per value.
 *
 * **`optionAxes[]` stays separate from `attributes[]` on purpose** — they
 * are different concepts, not different names for the same thing. Option
 * axes (colour, size) participate in `variantKey` and the variant matrix
 * engine: every variant must carry exactly one value per axis. Attributes
 * (material, fit, fabric, care) are product-level facts that never
 * distinguish one variant from another and never appear in `variantKey`.
 * Merging them would let a facet value accidentally behave like a variant
 * axis or vice versa — the architecture review flagged this explicitly as a
 * concept not to merge.
 */
/** `ProductSchema.group`: which group a product is in, what it is called there, and where it sits. */
export interface ProductGroupMembership {
  groupId: mongoose.Types.ObjectId;
  label: LocalizedString;
  order: number;
}

/** `ProductSchema.contents`: one product this product contains ("what's inside" a gift box), and how many. */
export interface ProductContentEntry {
  productId: mongoose.Types.ObjectId;
  quantity: number;
}

@MongoSchema({ timestamps: true })
export class ProductSchema {
  _id!: mongoose.Types.ObjectId;

  @Searchable({ subPaths: ["ar", "en"] })
  @MongoField(localizedStringField())
  name!: LocalizedString;

  @Searchable({ subPaths: ["ar", "en"] })
  @MongoField(localizedStringField())
  description!: LocalizedString;

  @Unique()
  @MongoField({ type: String, required: true, trim: true })
  slug!: string;

  @Filterable()
  @Relation(() => CategorySchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Category" })
  categoryId!: mongoose.Types.ObjectId;

  /**
   * Many-to-many: product belongs to multiple flat merchandising collections.
   */
  @MongoField({ type: [mongoose.Schema.Types.ObjectId], default: () => [] })
  collectionIds!: mongoose.Types.ObjectId[];

  @Filterable()
  @Relation(() => BrandSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false, ref: "Brand" })
  brandId?: mongoose.Types.ObjectId;

  /** Optional reusable size chart. Absent means the product has no size guide (e.g. non-apparel). */
  @Relation(() => SizeGuideSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false, ref: "SizeGuide" })
  sizeGuide?: mongoose.Types.ObjectId;

  /**
   * Primary gallery — applies to all variants unless overridden.
   */
  @MongoField({ type: [imageAssetField().type], default: () => [] })
  images!: ImageAsset[];

  /**
   * Option axes define variant dimensions (colour, size) — participate in
   * `variantKey` and the variant matrix engine. Never a merchandising
   * attribute; see the class doc comment for why the two stay separate.
   * Example: [{key: "colour", name: {ar: "اللون", en: "Colour"}}, {key: "size", ...}]
   *
   * Axis keys are immutable identifiers. Display names, value labels and swatches
   * are localized/display-only and mutable.
   */
  @MongoField({
    type: [
      new mongoose.Schema(
        {
          key: { type: String, required: true },
          name: localizedStringSchema(),
          /*
           * Optional, additive: labels (and an optional swatch) for the values
           * variants carry on this axis. `default: undefined` keeps an axis
           * without them exactly as stored before — no empty array appears.
           */
          values: {
            type: [
              new mongoose.Schema(
                {
                  key: { type: String, required: true },
                  label: localizedStringSchema(),
                  swatch: { type: String, required: false, match: /^#[0-9A-Fa-f]{6}$/ },
                },
                { _id: false }
              ),
            ],
            default: undefined,
          },
        },
        { _id: false }
      ),
    ],
    default: () => [],
  })
  optionAxes!: Array<{ key: string; name: LocalizedString; values?: Array<{ key: string; label: LocalizedString; swatch?: string }> }>;

  /**
   * Product-level merchandising facts (material, fit, fabric, care) — never
   * a variant-defining dimension. Structured (not a bare `Record`) so a
   * facet-aggregation pipeline can filter and count per value; `key` is an
   * immutable identifier, `name`/value labels are localized and editable.
   */
  @MongoField({
    type: [
      new mongoose.Schema(
        {
          key: { type: String, required: true },
          name: localizedStringSchema(),
          values: {
            type: [new mongoose.Schema({ key: { type: String, required: true }, value: localizedStringSchema() }, { _id: false })],
            default: () => [],
          },
        },
        { _id: false }
      ),
    ],
    default: () => [],
  })
  attributes!: Array<{ key: string; name: LocalizedString; values: Array<{ key: string; value: LocalizedString }> }>;

  @MongoField(localizedStringField())
  seoTitle!: LocalizedString;

  @MongoField(localizedStringField())
  seoDescription!: LocalizedString;

  /**
   * Lifecycle state: draft, published, or archived.
   */
  @Filterable()
  @MongoField({ type: String, enum: ["draft", "published", "archived"], default: "draft" })
  lifecycle!: "draft" | "published" | "archived";

  /** Scheduled publish time. A `draft` product with `publishAt` in the future is not surfaced by any storefront route until then — enforcement lives at the route layer (Phase 4B); this schema only carries the timestamp. */
  @MongoField({ type: Date, required: false })
  publishAt?: Date;

  /** Display/sort position within a category or collection listing. */
  @MongoField({ type: Number, default: 0 })
  order!: number;

  /**
   * The product group this product belongs to, if any — see `ProductGroupSchema` for why membership lives here.
   * `label` is how the storefront names this product among its group ("Brown", "بني"); `order` its place in the
   * group. Absent on every product that is not grouped, which is every product written before groups existed.
   *
   * Written ONLY by the product-group services (`admin/product-groups/*`). Product create, update, lifecycle, clone
   * and catalog import name their fields explicitly and never touch this one, so editing or archiving a product
   * keeps its membership and a clone does not inherit it.
   */
  @MongoField({
    type: new mongoose.Schema(
      {
        groupId: { type: mongoose.Schema.Types.ObjectId, ref: "ProductGroup", required: true, index: true },
        label: localizedStringSchema(),
        order: { type: Number, required: true, default: 0 },
      },
      { _id: false }
    ),
    required: false,
    default: undefined,
  })
  group?: ProductGroupMembership;

  /**
   * The other products this product contains — "what's inside" a gift box — in display order. REFERENCES, never
   * copies: the storefront resolves each entry's live name and images at read time, so editing an included product
   * shows on the box's page automatically. The box stays an independent product (own variants, price, stock, orders);
   * this is not a bundle and does not touch stock. Absent on every product with no contents.
   *
   * Written ONLY by the product-contents service (`admin/product-contents/*`). Product create, update, lifecycle,
   * clone and catalog import name their fields explicitly and never touch this one.
   */
  @MongoField({
    type: [
      new mongoose.Schema(
        {
          productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
          quantity: { type: Number, required: true, min: 1, max: 99, validate: { validator: Number.isInteger, message: "quantity must be an integer" } },
        },
        { _id: false }
      ),
    ],
    required: false,
    default: undefined,
  })
  contents?: ProductContentEntry[];

  /**
   * Materialised listing rollup (MDS §8.2/§12) — maintained transactionally,
   * never computed on read. See `catalog/rollups/maintain-product-listing.ts`.
   */
  @MongoField({
    /*
     * `moneyField()` is passed whole, not `.type` — the whole object carries
     * the rounding setter and reviving getter, and this repo's own
     * `CLAUDE.md` names taking only `.type` as the exact silent-corruption
     * mistake to avoid. `moneyField()`'s own doc comment shows this precise
     * "inside a hand-written sub-schema" usage.
     */
    type: new mongoose.Schema(
      {
        minActivePrice: moneyField(),
        maxActivePrice: moneyField(),
        /** Cheapest purchasable variant's compare-at, only when it exceeds that variant's price — the listing's "Sale" signal. */
        compareAtPrice: moneyField(),
        purchasableVariantCount: { type: Number, required: true, default: 0 },
        /*
         * `key:value` option pairs (`size:m`) present on at least one PURCHASABLE variant — the filterable,
         * facetable set (plan #7). A flat array of strings so a filter is a plain `$in` and a facet a plain
         * `$unwind`; `default: undefined` keeps a product that has never been rolled up exactly as stored.
         */
        availableOptions: { type: [String], default: undefined },
        /* Low-stock facts (plan #19), independent of the store-wide threshold — see `catalog/rollups/listing-options.ts`. */
        lowStockOverride: { type: Boolean, required: false },
        minTrackedStock: { type: Number, required: false },
        /*
         * Hand-written, not `imageAssetField().type` — that helper's return
         * type is `MongoFieldOptions` (`type: unknown`, by design, so the
         * `@MongoField()` decorator can accept it), and `unknown` cannot be
         * matched against `SchemaDefinitionProperty` inside a hand-written
         * `new mongoose.Schema({...})` literal — the exact class of failure
         * `moneyField()`'s own doc comment describes and defines a narrower
         * `MoneyFieldDefinition` type specifically to avoid.
         * `imageAssetField()` has no equivalent narrow type, so the fields
         * are written out here instead.
         */
        primaryImage: {
          type: new mongoose.Schema(
            {
              provider: { type: String, required: true },
              publicId: { type: String, required: true },
              secureUrl: { type: String, required: true },
              format: { type: String, required: true },
              width: { type: Number, required: true },
              height: { type: Number, required: true },
              bytes: { type: Number, required: true },
              version: { type: Number, required: false },
              placeholderUrl: { type: String, required: false },
            },
            { _id: false }
          ),
          required: false,
        },
      },
      { _id: false }
    ),
    default: () => ({ purchasableVariantCount: 0 }),
  })
  listing!: {
    minActivePrice?: Money;
    maxActivePrice?: Money;
    compareAtPrice?: Money;
    purchasableVariantCount: number;
    availableOptions?: string[];
    lowStockOverride?: boolean;
    minTrackedStock?: number;
    primaryImage?: ImageAsset;
  };

  /**
   * Materialised ratings rollup, new in Phase 4A.5 — see class doc comment.
   * Maintained by `content/rollups/maintain-ratings-summary.ts`, driven
   * solely by `Review.status === "APPROVED"` membership.
   */
  @MongoField({
    type: new mongoose.Schema({ average: { type: Number, required: true, default: 0 }, count: { type: Number, required: true, default: 0 } }, { _id: false }),
    default: () => ({ average: 0, count: 0 }),
  })
  ratingsSummary!: { average: number; count: number };
}

// Forward declarations for relations
class CategorySchema {
  _id!: mongoose.Types.ObjectId;
}
class BrandSchema {
  _id!: mongoose.Types.ObjectId;
}
class SizeGuideSchema {
  _id!: mongoose.Types.ObjectId;
}

export const ProductModel = createMongoModel("Product", ProductSchema);
