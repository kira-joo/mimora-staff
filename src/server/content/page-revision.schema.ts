import { MongoField, MongoSchema, Unique, localizedStringField, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * PageRevision — the immutable text of one version of a `Page`.
 *
 * D-13 (`mimora-client/docs/legal-and-consent.md` §"Recording acceptance"):
 * "terms pages are versioned, and an edit creates a new version rather than
 * mutating the old one." An order records only the version number it
 * accepted (`Order.termsVersionAccepted`), so the text that number refers to
 * has to survive every later edit — otherwise the record names a version
 * nobody can read back. Written only by `createPage`/`updatePage`, in the
 * same transaction as the page itself; never updated.
 */
@MongoSchema({ timestamps: true })
export class PageRevisionSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField({ type: mongoose.Schema.Types.ObjectId, ref: "Page", required: true, index: true })
  pageId!: mongoose.Types.ObjectId;

  /** The page's slug when this version was written — a later slug change does not rewrite history. */
  @MongoField({ type: String, required: true })
  slug!: string;

  @MongoField({ type: Number, required: true })
  version!: number;

  /**
   * `${pageId}:${version}` — one revision per version of a page. `@Unique()`
   * is single-field only, so the compound invariant is a derived key, the
   * same way `Variant.variantKey` guards one variant per axis combination.
   */
  @Unique()
  @MongoField({ type: String, required: true })
  revisionKey!: string;

  @MongoField(localizedStringField())
  title!: LocalizedString;

  @MongoField(localizedStringField())
  content!: LocalizedString;
}

export const PageRevisionModel = createMongoModel("PageRevision", PageRevisionSchema);
