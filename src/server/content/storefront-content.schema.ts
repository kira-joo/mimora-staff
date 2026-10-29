import { MongoField, MongoSchema, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { HOME_SECTION_TYPES, LINK_KINDS, type StorefrontContentBody } from "./storefront-content.types";

/*
 * Hand-written sub-schemas: the decorators cannot express a nested array of
 * a union, and `@MongoField({ type })` is not checked against the
 * interface beside it — `storefront-content.integration.test.ts` round-trips
 * every section type to catch a mismatch.
 */
const localized = new mongoose.Schema({ ar: { type: String, default: "" }, en: { type: String, default: "" } }, { _id: false });

const linkTarget = new mongoose.Schema(
  { kind: { type: String, enum: LINK_KINDS, required: true }, id: { type: mongoose.Schema.Types.ObjectId, required: true } },
  { _id: false }
);

const announcement = new mongoose.Schema(
  {
    message: { type: localized, required: true },
    target: { type: linkTarget, required: false },
    startsAt: { type: Date, required: false },
    endsAt: { type: Date, required: false },
    enabled: { type: Boolean, required: true, default: true },
  },
  { _id: false }
);

const navItem = new mongoose.Schema({ target: { type: linkTarget, required: true }, label: { type: localized, required: false } }, { _id: false });

/** One shape for every section type; which fields are present is the section type's contract, enforced on write (DTO + `assertDraftShape`). */
const homeSection = new mongoose.Schema(
  {
    type: { type: String, enum: HOME_SECTION_TYPES, required: true },
    headline: { type: localized, required: false },
    subline: { type: localized, required: false },
    actionLabel: { type: localized, required: false },
    target: { type: linkTarget, required: false },
    heading: { type: localized, required: false },
    body: { type: localized, required: false },
    source: { type: String, enum: ["collection", "newest"], required: false },
    collectionId: { type: mongoose.Schema.Types.ObjectId, required: false },
    categoryIds: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
  },
  { _id: false }
);

const contentBody = new mongoose.Schema(
  {
    announcements: { type: [announcement], default: () => [] },
    headerNavigation: { type: [navItem], default: () => [] },
    footerNavigation: { type: [navItem], default: () => [] },
    homeSections: { type: [homeSection], default: () => [] },
  },
  { _id: false }
);

/**
 * StorefrontContent — a singleton (one per store), read and written only
 * through `admin/storefront-content/*` and `storefront/get-storefront-content.ts`.
 *
 * Draft then publish (owner decision): the merchant edits `draft` freely;
 * customers only ever see `published`, which changes in exactly one place —
 * publishing, which copies the draft the merchant previewed.
 * `draftRevision` moves on every save; publishing names the revision it
 * previewed and is refused if the draft has moved since, so what goes live
 * is what was checked.
 */
@MongoSchema({ timestamps: true })
export class StorefrontContentSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField({ type: contentBody, default: () => ({}) })
  draft!: StorefrontContentBody;

  @MongoField({ type: Number, required: true, default: 0 })
  draftRevision!: number;

  @MongoField({ type: contentBody, required: false })
  published?: StorefrontContentBody;

  @MongoField({ type: Number, required: false })
  publishedRevision?: number;

  @MongoField({ type: Date, required: false })
  publishedAt?: Date;

  @MongoField({ type: mongoose.Schema.Types.ObjectId, ref: "StaffUser", required: false })
  publishedBy?: mongoose.Types.ObjectId;
}

export const StorefrontContentModel = createMongoModel("StorefrontContent", StorefrontContentSchema);
