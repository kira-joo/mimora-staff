import { MongoField, MongoSchema, Unique, localizedStringField, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * Page — a CMS content page (about, contact, legal — per MDS §17: "Home
 * sections, featured collections, offer copy, pages (about, contact,
 * legal), SEO defaults. All localized, all cache-tagged."). New in this
 * pass (same status as the other three entities added here — not in Phase
 * 4A.5's own checklist, found genuinely missing by the Phase 4B
 * verification pass; required by the storefront `pages/[slug]` route and
 * the admin Pages/CMS CRUD batch in the canonical route inventory).
 *
 * MDS gives no field-level shape for this entity (§17 names the concept,
 * not its schema) — derived here from the pattern every other
 * localized/SEO-bearing content entity in this codebase already uses
 * (`StoreProfile.defaultSeo`, `Product.seoTitle`/`seoDescription`), kept to
 * exactly what a legal/informational content page needs: no lifecycle
 * beyond published/unpublished (unlike `Product`, a static page has no
 * draft-review workflow implied anywhere in MDS, so a boolean is the
 * correct — not merely simpler — shape here, not the corner MDS §12 warns
 * a boolean gets cut in for a concurrently-written rollup; a page is
 * edited by one staff member at a time, not contended the way stock is).
 */
@MongoSchema({ timestamps: true })
export class PageSchema {
  _id!: mongoose.Types.ObjectId;

  @Unique()
  @MongoField({ type: String, required: true, trim: true })
  slug!: string;

  @MongoField(localizedStringField())
  title!: LocalizedString;

  @MongoField(localizedStringField())
  content!: LocalizedString;

  @MongoField({ type: Boolean, default: false })
  published!: boolean;

  /**
   * D-13: the version of `title` + `content` currently live. Starts at 1 and
   * moves only when either changes; every version's text is kept in
   * `PageRevision`. The storefront shows it beside the terms it asks a
   * customer to accept, and the order records the one that was accepted.
   */
  @MongoField({ type: Number, required: true, default: 1 })
  version!: number;

  @MongoField({
    type: new mongoose.Schema(
      {
        title: { type: mongoose.Schema.Types.Mixed, required: false },
        description: { type: mongoose.Schema.Types.Mixed, required: false },
        ogImage: {
          type: new mongoose.Schema(
            { provider: String, publicId: String, secureUrl: String, format: String, width: Number, height: Number, bytes: Number, version: Number, placeholderUrl: String },
            { _id: false }
          ),
          required: false,
        },
      },
      { _id: false }
    ),
    default: () => ({}),
  })
  seo!: { title?: LocalizedString; description?: LocalizedString; ogImage?: ImageAsset };
}

export const PageModel = createMongoModel("Page", PageSchema);
