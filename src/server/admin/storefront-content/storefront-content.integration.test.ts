import mongoose from "mongoose";
import { ConflictError, ValidationFailedError } from "@kira-joo/backend-toolkit-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CategoryModel } from "../../catalog/category.schema";
import { CollectionModel } from "../../catalog/collection.schema";
import { PageModel } from "../../content/page.schema";
import { StoreProfileModel } from "../../content/store-profile.schema";
import { StorefrontContentModel } from "../../content/storefront-content.schema";
import { getStorefrontContent } from "../../storefront/get-storefront-content";
import type { SaveStorefrontContentDraftDto } from "../dto/storefront-content.dto";
import { getStorefrontContentAdmin, previewStorefrontContentDraft, publishStorefrontContent, saveStorefrontContentDraft } from "./storefront-content";

/**
 * Plan #78–80, owner decisions 2026-10-12: one storefront-content record,
 * draft then publish; six section types (D-S3); several announcements, one
 * shown at a time; configurable footer, legal links always present.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const L = (ar: string, en: string) => ({ ar, en });
const STAFF = new mongoose.Types.ObjectId().toString();
const NOW = new Date("2026-10-12T12:00:00Z");

let collectionId: string;
let categoryId: string;
let aboutPageId: string;

const empty = (): SaveStorefrontContentDraftDto => ({ announcements: [], headerNavigation: [], footerNavigation: [], homeSections: [] });

async function fieldsOf(promise: Promise<unknown>): Promise<string[]> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ValidationFailedError);
  return (error as ValidationFailedError).validationErrors.map((e) => e.field);
}

async function saveAndPublish(draft: SaveStorefrontContentDraftDto) {
  const saved = await saveStorefrontContentDraft(draft);
  return publishStorefrontContent(saved.draftRevision, STAFF, NOW);
}

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await Promise.all([StorefrontContentModel.deleteMany({}), CategoryModel.deleteMany({}), CollectionModel.deleteMany({}), PageModel.deleteMany({}), StoreProfileModel.deleteMany({})]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([StorefrontContentModel.deleteMany({}), CategoryModel.deleteMany({}), CollectionModel.deleteMany({}), PageModel.deleteMany({}), StoreProfileModel.deleteMany({})]);
  collectionId = (await CollectionModel.create({ name: L("خريف", "Autumn"), description: L("", ""), slug: "autumn", sortOrder: 0, published: true }))._id.toString();
  categoryId = (await CategoryModel.create({ name: L("قمصان", "Shirts"), slug: "shirts", sortOrder: 0, published: true }))._id.toString();
  aboutPageId = (await PageModel.create({ slug: "about", title: L("من نحن", "About"), content: L("نص", "Text"), published: true }))._id.toString();
});

describe("every section type round-trips through the stored shape", () => {
  it("keeps exactly each section's own fields", async () => {
    const draft: SaveStorefrontContentDraftDto = {
      announcements: [{ message: L("شحن مجاني", "Free delivery"), target: { kind: "collection", id: collectionId }, startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z", enabled: true }],
      headerNavigation: [{ target: { kind: "category", id: categoryId } }],
      footerNavigation: [{ target: { kind: "page", id: aboutPageId }, label: L("قصتنا", "Our story") }],
      homeSections: [
        { type: "campaignHero", headline: L("أشياء تدوم", "Things that last"), subline: L("خريف", "Autumn"), actionLabel: L("تسوق", "Shop"), target: { kind: "collection", id: collectionId } },
        { type: "collectionStory", collectionId, heading: L("القصة", "The story"), body: L("نص", "Text") },
        { type: "productRail", source: "collection", collectionId, heading: L("مختارات", "Picks") },
        { type: "productRail", source: "newest" },
        { type: "categoryTiles", categoryIds: [categoryId], heading: L("تسوق حسب الفئة", "Shop by category") },
        { type: "editorialBand", collectionId, headline: L("مصنوع بعناية", "Made with care") },
        { type: "assuranceStrip" },
      ],
    };

    const { draft: stored } = await saveStorefrontContentDraft(draft);
    const raw = await StorefrontContentModel.collection.findOne({});

    expect(stored.homeSections.map((section) => section.type)).toEqual(["campaignHero", "collectionStory", "productRail", "productRail", "categoryTiles", "editorialBand", "assuranceStrip"]);
    expect(Object.keys(raw!.draft.homeSections[3]).sort()).toEqual(["source", "type"]);
    expect(Object.keys(raw!.draft.homeSections[6])).toEqual(["type"]);
    expect(raw!.draft.homeSections[4].categoryIds[0].toString()).toBe(categoryId);
    expect(raw!.draft.announcements[0].startsAt).toEqual(new Date("2026-10-01T00:00:00.000Z"));
    expect(raw!.draft.footerNavigation[0].label).toEqual(L("قصتنا", "Our story"));
  });
});

describe("draft then publish", () => {
  it("a saved draft is never served to customers", async () => {
    await saveStorefrontContentDraft({ ...empty(), homeSections: [{ type: "assuranceStrip" }] });
    expect((await getStorefrontContent(NOW)).homeSections).toEqual([]);
    expect((await getStorefrontContentAdmin()).hasUnpublishedChanges).toBe(true);
  });

  it("publishing makes the previewed draft live, and nothing is unpublished afterwards", async () => {
    await saveStorefrontContentDraft({ ...empty(), homeSections: [{ type: "productRail", source: "newest" }] });
    const preview = await previewStorefrontContentDraft(NOW);
    expect(preview.problems).toEqual([]);

    const after = await publishStorefrontContent(preview.draftRevision, STAFF, NOW);
    expect(after.hasUnpublishedChanges).toBe(false);
    expect(after.publishedAt).toEqual(NOW);
    expect((await getStorefrontContent(NOW)).homeSections).toEqual([{ type: "productRail", source: "newest" }]);
  });

  it("refuses to publish a draft saved after the preview — what goes live is what was checked", async () => {
    await saveStorefrontContentDraft({ ...empty(), homeSections: [{ type: "productRail", source: "newest" }] });
    const preview = await previewStorefrontContentDraft(NOW);
    await saveStorefrontContentDraft({ ...empty(), homeSections: [{ type: "assuranceStrip" }] });

    const error = await publishStorefrontContent(preview.draftRevision, STAFF, NOW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).details).toMatchObject({ reason: "DRAFT_CHANGED" });
    expect((await getStorefrontContent(NOW)).homeSections).toEqual([]);
  });

  it("a later draft leaves what is live untouched until it is published", async () => {
    await saveAndPublish({ ...empty(), homeSections: [{ type: "productRail", source: "newest" }] });
    await saveStorefrontContentDraft({ ...empty(), homeSections: [{ type: "assuranceStrip" }] });

    expect((await getStorefrontContent(NOW)).homeSections).toEqual([{ type: "productRail", source: "newest" }]);
    expect((await getStorefrontContentAdmin()).hasUnpublishedChanges).toBe(true);
  });
});

describe("publishing refuses anything that would show a customer a gap", () => {
  it("a reference to something unpublished or missing, by field", async () => {
    await CollectionModel.updateOne({ _id: collectionId }, { $set: { published: false } });
    const missing = new mongoose.Types.ObjectId().toString();
    const saved = await saveStorefrontContentDraft({
      ...empty(),
      headerNavigation: [{ target: { kind: "category", id: missing } }],
      homeSections: [{ type: "editorialBand", collectionId, headline: L("عنوان", "Headline") }],
    });

    expect(await fieldsOf(publishStorefrontContent(saved.draftRevision, STAFF, NOW))).toEqual(["headerNavigation.0.target", "homeSections.0.collectionId"]);
    expect((await getStorefrontContentAdmin()).published).toBeNull();
  });

  it("text missing the default locale (D-11), but not optional text blank in both", async () => {
    const saved = await saveStorefrontContentDraft({
      ...empty(),
      announcements: [{ message: L("", "Free delivery"), enabled: true }],
      homeSections: [{ type: "campaignHero", headline: L("", "Things that last"), subline: L("", "") }],
    });
    expect(await fieldsOf(publishStorefrontContent(saved.draftRevision, STAFF, NOW))).toEqual(["announcements.0.message", "homeSections.0.headline"]);
  });

  it("the preview lists the same problems without throwing", async () => {
    await saveStorefrontContentDraft({ ...empty(), announcements: [{ message: L("", "Free delivery"), enabled: true }] });
    expect((await previewStorefrontContentDraft(NOW)).problems.map((problem) => problem.field)).toEqual(["announcements.0.message"]);
  });
});

describe("the draft's structure is enforced on every save", () => {
  it.each([
    ["a hero that is not first", [{ type: "assuranceStrip" }, { type: "campaignHero", headline: L("ع", "H") }], ["homeSections.1.type"]],
    ["a second assurance strip", [{ type: "assuranceStrip" }, { type: "assuranceStrip" }], ["homeSections.1.type"]],
    ["a hero action without a destination", [{ type: "campaignHero", headline: L("ع", "H"), actionLabel: L("تسوق", "Shop") }], ["homeSections.0.target"]],
    ["a collection rail without a collection", [{ type: "productRail", source: "collection" }], ["homeSections.0.collectionId"]],
  ] as const)("refuses %s", async (_, homeSections, fields) => {
    expect(await fieldsOf(saveStorefrontContentDraft({ ...empty(), homeSections: homeSections as never }))).toEqual(fields);
  });

  it("refuses an announcement that ends before it starts", async () => {
    const draft = { ...empty(), announcements: [{ message: L("ع", "A"), startsAt: "2026-10-10T00:00:00Z", endsAt: "2026-10-09T00:00:00Z", enabled: true }] };
    expect(await fieldsOf(saveStorefrontContentDraft(draft))).toEqual(["announcements.0.endsAt"]);
  });
});

describe("what customers see", () => {
  it("shows one announcement at a time — the first enabled one in its window — and when that changes", async () => {
    await saveAndPublish({
      ...empty(),
      announcements: [
        { message: L("معطل", "Disabled"), enabled: false },
        { message: L("قادم", "Upcoming"), startsAt: "2026-10-20T00:00:00.000Z", enabled: true },
        { message: L("الآن", "Now"), endsAt: "2026-10-15T00:00:00.000Z", enabled: true },
        { message: L("دائم", "Always"), enabled: true },
      ],
    });

    const view = await getStorefrontContent(NOW);
    expect(view.announcement?.message).toEqual(L("الآن", "Now"));
    expect(view.announcementChangesAt).toEqual(new Date("2026-10-15T00:00:00.000Z"));
    expect((await getStorefrontContent(new Date("2026-10-16T00:00:00Z"))).announcement?.message).toEqual(L("دائم", "Always"));
    expect((await getStorefrontContent(new Date("2026-10-21T00:00:00Z"))).announcement?.message).toEqual(L("قادم", "Upcoming"));
  });

  it("resolves links to slugs and names, using the merchant's label when there is one", async () => {
    await saveAndPublish({
      ...empty(),
      headerNavigation: [{ target: { kind: "category", id: categoryId } }, { target: { kind: "collection", id: collectionId }, label: L("الجديد", "New in") }],
    });
    expect((await getStorefrontContent(NOW)).headerNavigation).toEqual([
      { kind: "category", slug: "shirts", label: L("قمصان", "Shirts") },
      { kind: "collection", slug: "autumn", label: L("الجديد", "New in") },
    ]);
  });

  it("always lists the published legal pages, whatever the footer navigation holds", async () => {
    await PageModel.create({ slug: "terms", title: L("شروط البيع", "Terms of Sale"), content: L("نص", "Text"), published: true });
    await PageModel.create({ slug: "contact", title: L("اتصل بنا", "Contact"), content: L("نص", "Text"), published: true });
    await PageModel.create({ slug: "privacy", title: L("الخصوصية", "Privacy"), content: L("نص", "Text"), published: false });

    expect((await getStorefrontContent(NOW)).legalLinks.map((link) => link.slug)).toEqual(["terms", "contact"]);
  });

  it("drops a section whose collection is unpublished after publishing — less, never an empty frame", async () => {
    await saveAndPublish({ ...empty(), homeSections: [{ type: "collectionStory", collectionId }, { type: "assuranceStrip" }] });
    await CollectionModel.updateOne({ _id: collectionId }, { $set: { published: false } });

    expect((await getStorefrontContent(NOW)).homeSections).toEqual([{ type: "assuranceStrip" }]);
  });

  it("takes the hero image from the store profile", async () => {
    const heroMedia = { provider: "cloudinary", publicId: "hero", secureUrl: "https://example.com/hero.jpg", format: "jpg", width: 1600, height: 900, bytes: 1 };
    await StoreProfileModel.collection.insertOne({ heroMedia });
    await saveAndPublish({ ...empty(), homeSections: [{ type: "campaignHero", headline: L("أشياء تدوم", "Things that last") }] });

    const [hero] = (await getStorefrontContent(NOW)).homeSections;
    expect(hero).toMatchObject({ type: "campaignHero", image: { secureUrl: "https://example.com/hero.jpg" } });
  });
});
