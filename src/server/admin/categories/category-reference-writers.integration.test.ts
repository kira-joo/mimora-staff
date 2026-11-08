import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ServiceUnavailableError, ValidationFailedError } from "@kira-joo/backend-toolkit-core";
import { getActiveTransaction, withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { connectToDatabase } from "../../core/db/connect";
import { CatalogImportBatchModel } from "../../catalog/catalog-import-batch.schema";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { StockMovementModel } from "../../catalog/stock-movement.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { PromotionModel } from "../../commerce/promotion.schema";
import { StoreProfileModel } from "../../content/store-profile.schema";
import { StorefrontContentModel } from "../../content/storefront-content.schema";
import { collectReferences } from "../../content/resolve-storefront-content";
import { createPromotion } from "../promotions/create-promotion";
import { updatePromotion } from "../promotions/update-promotion";
import { publishCatalogImportBatch } from "../catalog-import/publish-catalog-import-batch";
import { stageCatalogImport } from "../catalog-import/stage-catalog-import";
import { getStorefrontContentAdmin, publishStorefrontContent, saveStorefrontContentDraft } from "../storefront-content/storefront-content";
import type { SaveStorefrontContentDraftDto } from "../dto/storefront-content.dto";
import { createCategory } from "./create-category";
import { deleteCategory } from "./delete-category";
import { updateCategory } from "./update-category";
import { touchCategory } from "./category-hierarchy";

/**
 * Every OTHER writer that stores a reference to a category — a promotion's category conditions, the storefront
 * content draft and its publish, a bulk catalog import's publish — must take the same lock as a product
 * assignment (`category-concurrency.integration.test.ts`): write the category first, so a concurrent
 * `deleteCategory` conflicts instead of committing beside it. Each path gets the held-open-transaction pair (the
 * writer in flight blocks the delete; the delete in flight blocks the writer, which is then refused), a
 * "missing category is refused" test, and real races.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const L = (ar: string, en: string) => ({ ar, en });
const LOCALIZED = { ar: "نص", en: "Text" };
const STAFF = new mongoose.Types.ObjectId().toString();
const NOW = new Date("2026-11-06T12:00:00Z");
let counter = 0;
const make = (published = false) => createCategory({ name: LOCALIZED, description: LOCALIZED, slug: `ref-${(counter += 1)}`, seoTitle: LOCALIZED, seoDescription: LOCALIZED, published });
const id = (category: { _id: mongoose.Types.ObjectId }) => category._id.toString();
const ghost = () => new mongoose.Types.ObjectId().toString();

const emptyDraft = (): SaveStorefrontContentDraftDto => ({ announcements: [], headerNavigation: [], footerNavigation: [], homeSections: [] });
const tilesDraft = (...categoryIds: string[]): SaveStorefrontContentDraftDto => ({ ...emptyDraft(), homeSections: [{ type: "categoryTiles", categoryIds }] });
const navDraft = (categoryId: string): SaveStorefrontContentDraftDto => ({ ...emptyDraft(), headerNavigation: [{ target: { kind: "category", id: categoryId } }] });

const promote = (categories: string[]) => createPromotion({ name: LOCALIZED, description: LOCALIZED, type: "PERCENT", value: toMoney("10"), conditions: { categories } });

const holders: Array<{ release: () => void; done: Promise<void> }> = [];

/** A transaction held open on purpose: runs `work`, signals it is in flight, then waits for `release()` before committing. */
function holdTransaction(work: () => Promise<void>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let inFlight!: () => void;
  const ready = new Promise<void>((resolve) => (inFlight = resolve));
  const done = withTransaction(async (tx) => {
    await work();
    inFlight();
    await gate;
    return tx.complete(undefined);
  });
  const held = { ready, release, done };
  holders.push(held);
  return held;
}

/** A `deleteCategory` caught mid-flight: it has touched the category and removed it, but not yet committed. */
const holdDelete = (categoryId: string) =>
  holdTransaction(async () => {
    await touchCategory(categoryId); // exactly what deleteCategory does first
    await CategoryModel.deleteOne({ _id: categoryId }, { session: getActiveTransaction()!.session });
  });

async function knownCategories() {
  return new Set((await CategoryModel.find({}, { _id: 1 }).lean()).map((category) => category._id.toString()));
}

/** The invariant: no promotion, draft or published content names a category that does not exist. */
async function danglingReferences(): Promise<string[]> {
  const known = await knownCategories();
  const dangling: string[] = [];
  for (const promotion of await PromotionModel.collection.find({}).toArray()) {
    for (const categoryId of (promotion.conditions?.categories ?? []) as mongoose.Types.ObjectId[]) if (!known.has(String(categoryId))) dangling.push(`promotion:${categoryId}`);
  }
  const content = await StorefrontContentModel.findOne({}).lean();
  for (const [label, body] of [["draft", content?.draft], ["published", content?.published]] as const) {
    if (!body) continue;
    for (const reference of collectReferences(body as never)) if (reference.kind === "category" && !known.has(reference.id.toString())) dangling.push(`${label}:${reference.id}`);
  }
  for (const product of await ProductModel.collection.find({}).toArray()) if (!known.has(String(product.categoryId))) dangling.push(`product:${product.categoryId}`);
  return dangling;
}

const reset = () =>
  Promise.all([
    CategoryModel.deleteMany({}),
    ProductModel.deleteMany({}),
    VariantModel.deleteMany({}),
    StockMovementModel.deleteMany({}),
    PromotionModel.collection.deleteMany({}),
    StorefrontContentModel.collection.deleteMany({}),
    CatalogImportBatchModel.deleteMany({}),
    StoreProfileModel.deleteMany({}),
  ]);

describe("category delete vs. every other writer that references a category", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });
  afterAll(async () => {
    await reset();
    await mongoose.disconnect();
  });
  afterEach(async () => {
    // A failed assertion must not leave a transaction open: it would hold its locks against every test after it.
    for (const held of holders.splice(0)) {
      held.release();
      await held.done.catch(() => undefined);
    }
  });
  beforeEach(reset);

  describe("promotion create", () => {
    it("a promotion being created in an open transaction blocks the delete; once it commits, the delete is refused for it", async () => {
      const category = await make();
      const creating = holdTransaction(async () => void (await promote([id(category)])));
      await creating.ready;

      // Without the write the delete would count no promotion (the insert is uncommitted) and succeed, leaving the promotion dangling.
      await expect(deleteCategory(id(category))).rejects.toThrow(ServiceUnavailableError);
      expect(await CategoryModel.countDocuments({ _id: category._id })).toBe(1);

      creating.release();
      await creating.done;
      await expect(deleteCategory(id(category))).rejects.toThrow(/1 promotion is limited to it/);
      expect(await danglingReferences()).toEqual([]);
    });

    it("a delete in flight blocks a promotion create; once it commits, the create is refused with 404 and no promotion exists", async () => {
      const category = await make();
      const deleting = holdDelete(id(category));
      await deleting.ready;

      await expect(promote([id(category)])).rejects.toThrow(ServiceUnavailableError);
      expect(await PromotionModel.countDocuments()).toBe(0);

      deleting.release();
      await deleting.done;
      await expect(promote([id(category)])).rejects.toThrow(NotFoundError);
      expect(await PromotionModel.countDocuments()).toBe(0);
      expect(await danglingReferences()).toEqual([]);
    });

    it("refuses a promotion limited to a category that does not exist, even beside a real one", async () => {
      const real = await make();
      await expect(promote([ghost()])).rejects.toThrow(/Category not found/);
      await expect(promote([id(real), ghost()])).rejects.toThrow(NotFoundError);
      expect(await PromotionModel.countDocuments()).toBe(0);
      // No category condition at all is still fine.
      await expect(promote([])).resolves.toBeDefined();
    });

    it("racing deletes against promotion creates never leaves a dangling promotion (30 real races)", async () => {
      const outcomes = { deleted: 0, created: 0 };
      for (let round = 0; round < 30; round += 1) {
        const category = await make();
        const [deletion, creation] = await Promise.allSettled([deleteCategory(id(category)), promote([id(category)])]);
        expect(await danglingReferences()).toEqual([]);
        expect(deletion.status === "fulfilled" && creation.status === "fulfilled").toBe(false);
        if (deletion.status === "fulfilled") outcomes.deleted += 1;
        if (creation.status === "fulfilled") outcomes.created += 1;
        await reset();
      }
      expect(outcomes.deleted + outcomes.created).toBeGreaterThan(0);
    });
  });

  describe("promotion update", () => {
    it("a promotion being limited to a new category in an open transaction blocks the delete; once it commits, the delete is refused for it", async () => {
      const [kept, added] = [await make(), await make()];
      const promotion = await promote([id(kept)]);
      const updating = holdTransaction(async () => void (await updatePromotion(id(promotion), { conditions: { categories: [id(kept), id(added)] } })));
      await updating.ready;

      await expect(deleteCategory(id(added))).rejects.toThrow(ServiceUnavailableError);
      expect(await CategoryModel.countDocuments({ _id: added._id })).toBe(1);

      updating.release();
      await updating.done;
      await expect(deleteCategory(id(added))).rejects.toThrow(/1 promotion is limited to it/);
      expect(await danglingReferences()).toEqual([]);
    });

    it("a delete in flight blocks adding that category to a promotion; once it commits, the update is refused and the promotion is unchanged", async () => {
      const [kept, doomed] = [await make(), await make()];
      const promotion = await promote([id(kept)]);
      const deleting = holdDelete(id(doomed));
      await deleting.ready;

      await expect(updatePromotion(id(promotion), { conditions: { categories: [id(kept), id(doomed)] } })).rejects.toThrow(ServiceUnavailableError);

      deleting.release();
      await deleting.done;
      await expect(updatePromotion(id(promotion), { conditions: { categories: [id(kept), id(doomed)] } })).rejects.toThrow(NotFoundError);
      const stored = await PromotionModel.collection.findOne({ _id: promotion._id });
      expect((stored?.conditions.categories as mongoose.Types.ObjectId[]).map(String)).toEqual([id(kept)]);
      expect(await danglingReferences()).toEqual([]);
    });

    it("refuses adding a category that does not exist, but an unrelated edit (or removing a category) never needs one", async () => {
      const real = await make();
      const promotion = await promote([id(real)]);
      await expect(updatePromotion(id(promotion), { conditions: { categories: [id(real), ghost()] } })).rejects.toThrow(/Category not found/);

      await expect(updatePromotion(id(promotion), { name: L("جديد", "Renamed") })).resolves.toBeDefined();
      await expect(updatePromotion(id(promotion), { conditions: { categories: [] } })).resolves.toBeDefined();
      expect(((await PromotionModel.collection.findOne({ _id: promotion._id }))?.conditions.categories as unknown[]).length).toBe(0);
    });

    it("racing deletes against a promotion gaining the category never leaves a dangling promotion (30 real races)", async () => {
      const outcomes = { deleted: 0, updated: 0 };
      for (let round = 0; round < 30; round += 1) {
        const [category, other] = [await make(), await make()];
        const promotion = await promote([id(other)]);
        const [deletion, update] = await Promise.allSettled([deleteCategory(id(category)), updatePromotion(id(promotion), { conditions: { categories: [id(other), id(category)] } })]);
        expect(await danglingReferences()).toEqual([]);
        expect(deletion.status === "fulfilled" && update.status === "fulfilled").toBe(false);
        if (deletion.status === "fulfilled") outcomes.deleted += 1;
        if (update.status === "fulfilled") outcomes.updated += 1;
        await reset();
      }
      expect(outcomes.deleted + outcomes.updated).toBeGreaterThan(0);
    });
  });

  describe("storefront content draft save", () => {
    it("a draft being saved with a new category link blocks the delete; once it commits, the delete is refused for it", async () => {
      const category = await make();
      const saving = holdTransaction(async () => void (await saveStorefrontContentDraft(tilesDraft(id(category)))));
      await saving.ready;

      await expect(deleteCategory(id(category))).rejects.toThrow(ServiceUnavailableError);
      expect(await CategoryModel.countDocuments({ _id: category._id })).toBe(1);

      saving.release();
      await saving.done;
      await expect(deleteCategory(id(category))).rejects.toThrow(/the storefront content links to it/);
      expect(await danglingReferences()).toEqual([]);
    });

    it("a delete in flight blocks a draft linking to that category; once it commits, the save is refused by field and the draft is unchanged", async () => {
      const [kept, doomed] = [await make(), await make()];
      const before = await saveStorefrontContentDraft(navDraft(id(kept)));
      const deleting = holdDelete(id(doomed));
      await deleting.ready;

      await expect(saveStorefrontContentDraft(tilesDraft(id(doomed)))).rejects.toThrow(ServiceUnavailableError);

      deleting.release();
      await deleting.done;
      const error = await saveStorefrontContentDraft({ ...navDraft(id(kept)), homeSections: [{ type: "categoryTiles", categoryIds: [id(kept), id(doomed)] }] }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationFailedError);
      expect((error as ValidationFailedError).validationErrors.map((entry) => entry.field)).toEqual(["homeSections.0.categoryIds.1"]);
      expect((await getStorefrontContentAdmin()).draftRevision).toBe(before.draftRevision);
      expect(await danglingReferences()).toEqual([]);
    });

    it("refuses a draft naming a category that does not exist, in every place a category can be linked", async () => {
      await expect(saveStorefrontContentDraft(navDraft(ghost()))).rejects.toThrow(ValidationFailedError);
      await expect(saveStorefrontContentDraft({ ...emptyDraft(), footerNavigation: [{ target: { kind: "category", id: ghost() } }] })).rejects.toThrow(ValidationFailedError);
      await expect(saveStorefrontContentDraft({ ...emptyDraft(), announcements: [{ message: L("ع", "A"), target: { kind: "category", id: ghost() }, enabled: true }] })).rejects.toThrow(ValidationFailedError);
      await expect(saveStorefrontContentDraft({ ...emptyDraft(), homeSections: [{ type: "campaignHero", headline: L("ع", "H"), actionLabel: L("ع", "A"), target: { kind: "category", id: ghost() } }] })).rejects.toThrow(ValidationFailedError);
      await expect(saveStorefrontContentDraft(tilesDraft(ghost()))).rejects.toThrow(ValidationFailedError);
      expect((await getStorefrontContentAdmin()).draftRevision).toBe(0);
    });

    it("an unpublished category can still be linked from a draft", async () => {
      const hidden = await make(false);
      await expect(saveStorefrontContentDraft(navDraft(id(hidden)))).resolves.toMatchObject({ draftRevision: 1 });
    });

    it("racing deletes against draft saves never leaves a dangling draft (30 real races)", async () => {
      const outcomes = { deleted: 0, saved: 0 };
      for (let round = 0; round < 30; round += 1) {
        const category = await make();
        const [deletion, save] = await Promise.allSettled([deleteCategory(id(category)), saveStorefrontContentDraft(tilesDraft(id(category)))]);
        expect(await danglingReferences()).toEqual([]);
        expect(deletion.status === "fulfilled" && save.status === "fulfilled").toBe(false);
        if (deletion.status === "fulfilled") outcomes.deleted += 1;
        if (save.status === "fulfilled") outcomes.saved += 1;
        await reset();
      }
      expect(outcomes.deleted + outcomes.saved).toBeGreaterThan(0);
    });
  });

  describe("storefront content publish", () => {
    it("a publish in an open transaction blocks the delete of a category it makes live", async () => {
      const category = await make(true);
      const saved = await saveStorefrontContentDraft(tilesDraft(id(category)));
      const publishing = holdTransaction(async () => void (await publishStorefrontContent(saved.draftRevision, STAFF, NOW)));
      await publishing.ready;

      await expect(deleteCategory(id(category))).rejects.toThrow(ServiceUnavailableError);

      publishing.release();
      await publishing.done;
      await expect(deleteCategory(id(category))).rejects.toThrow(/the storefront content links to it/);
      expect(await danglingReferences()).toEqual([]);
    });

    it("a delete in flight blocks a publish naming that category; once it commits, the publish is refused by field and nothing goes live", async () => {
      const category = await make(true);
      const saved = await saveStorefrontContentDraft(navDraft(id(category)));
      // The delete's reference check has already read the content (before the draft landed), so only the lock stands between them.
      const deleting = holdDelete(id(category));
      await deleting.ready;

      await expect(publishStorefrontContent(saved.draftRevision, STAFF, NOW)).rejects.toThrow(ServiceUnavailableError);
      expect((await getStorefrontContentAdmin()).published).toBeNull();

      deleting.release();
      await deleting.done;
      const error = await publishStorefrontContent(saved.draftRevision, STAFF, NOW).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationFailedError);
      expect((error as ValidationFailedError).validationErrors.map((entry) => entry.field)).toEqual(["headerNavigation.0.target"]);
      expect((await getStorefrontContentAdmin()).published).toBeNull();
      expect((await StorefrontContentModel.findOne({}).lean())?.publishedRevision).toBeUndefined();
    });

    it("an unpublish in flight blocks a publish linking the category; once it commits, the publish is refused", async () => {
      const category = await make(true);
      const saved = await saveStorefrontContentDraft(navDraft(id(category)));
      const unpublishing = holdTransaction(async () => void (await updateCategory(id(category), { published: false })));
      await unpublishing.ready;

      await expect(publishStorefrontContent(saved.draftRevision, STAFF, NOW)).rejects.toThrow(ServiceUnavailableError);

      unpublishing.release();
      await unpublishing.done;
      await expect(publishStorefrontContent(saved.draftRevision, STAFF, NOW)).rejects.toThrow(ValidationFailedError);
      expect((await getStorefrontContentAdmin()).published).toBeNull();
    });

    it("publishing a draft that links a category removed behind its back is refused by field", async () => {
      const category = await make(true);
      const saved = await saveStorefrontContentDraft(tilesDraft(id(category)));
      await CategoryModel.deleteOne({ _id: category._id });
      const error = await publishStorefrontContent(saved.draftRevision, STAFF, NOW).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ValidationFailedError);
      expect((error as ValidationFailedError).validationErrors.map((entry) => entry.field)).toEqual(["homeSections.0.categoryIds.0"]);
    });

    it("racing a publish against a delete that read the content before the draft landed never leaves live content linking a missing category (30 real races)", async () => {
      // `deleteCategory` itself refuses while a draft links the category, so the race that matters is the one where its
      // reference check has already run: model that by deleting in the same shape (touch, then remove) without the check.
      const rawDelete = (categoryId: string) =>
        withTransaction(async (tx) => {
          await touchCategory(categoryId);
          await CategoryModel.deleteOne({ _id: categoryId }, { session: getActiveTransaction()!.session });
          return tx.complete(undefined);
        });
      const outcomes = { deleted: 0, published: 0 };
      for (let round = 0; round < 30; round += 1) {
        const category = await make(true);
        const saved = await saveStorefrontContentDraft(tilesDraft(id(category)));
        const [deletion, publication] = await Promise.allSettled([rawDelete(id(category)), publishStorefrontContent(saved.draftRevision, STAFF, NOW)]);
        const content = await StorefrontContentModel.findOne({}).lean();
        // This raw delete has no reference check, so the only safe outcome when it wins is that the publish was refused.
        if (deletion.status === "fulfilled") expect(content?.published, "published content beside a deleted category").toBeUndefined();
        if (deletion.status === "fulfilled") outcomes.deleted += 1;
        if (publication.status === "fulfilled") outcomes.published += 1;
        await reset();
      }
      expect(outcomes.deleted + outcomes.published).toBeGreaterThan(0);
    });
  });

  describe("catalog import publish", () => {
    const HEADER = "product_slug,name_en,name_ar,description_ar,category_slug,status,sku,price,stock";
    const stage = (categorySlug: string) => stageCatalogImport({ content: [HEADER, `imp-${(counter += 1)},Item,صنف,وصف,${categorySlug},draft,SKU-${counter},10,1`].join("\n"), stagedBy: STAFF });
    const batchId = (batch: { _id: mongoose.Types.ObjectId }) => batch._id.toString();

    it("a publish in an open transaction blocks the delete of the category it assigns; once it commits, the delete is refused for the product", async () => {
      const category = await make();
      const batch = await stage(category.slug);
      expect(batch.rowErrors).toEqual([]);
      const publishing = holdTransaction(async () => void (await publishCatalogImportBatch(batchId(batch), STAFF)));
      await publishing.ready;

      await expect(deleteCategory(id(category))).rejects.toThrow(ServiceUnavailableError);

      publishing.release();
      await publishing.done;
      await expect(deleteCategory(id(category))).rejects.toThrow(/1 product is assigned to it/);
      expect(await danglingReferences()).toEqual([]);
    });

    it("a delete in flight blocks an import publish into that category; once it commits, the publish is refused, nothing is created and the batch stays STAGED", async () => {
      const category = await make();
      const batch = await stage(category.slug);
      const deleting = holdDelete(id(category));
      await deleting.ready;

      await expect(publishCatalogImportBatch(batchId(batch), STAFF)).rejects.toThrow(ServiceUnavailableError);
      expect(await ProductModel.countDocuments()).toBe(0);

      deleting.release();
      await deleting.done;
      await expect(publishCatalogImportBatch(batchId(batch), STAFF)).rejects.toThrow(/Category ".*" does not exist/);
      expect(await ProductModel.countDocuments()).toBe(0);
      expect((await CatalogImportBatchModel.findById(batch._id).lean())?.status).toBe("STAGED");
      expect(await danglingReferences()).toEqual([]);
    });

    it("staging a file naming a category that does not exist records a row error, so the batch can't publish", async () => {
      const batch = await stage("no-such-category");
      expect((batch.rowErrors as Array<{ message: string }>).map((entry) => entry.message).join()).toMatch(/does not exist/);
      await expect(publishCatalogImportBatch(batchId(batch), STAFF)).rejects.toThrow(/unresolved row errors/);
    });

    it("racing deletes against an import publish never leaves a dangling product (20 real races)", async () => {
      const outcomes = { deleted: 0, published: 0 };
      for (let round = 0; round < 20; round += 1) {
        const category = await make();
        const batch = await stage(category.slug);
        const [deletion, publication] = await Promise.allSettled([deleteCategory(id(category)), publishCatalogImportBatch(batchId(batch), STAFF)]);
        expect(await danglingReferences()).toEqual([]);
        expect(deletion.status === "fulfilled" && publication.status === "fulfilled").toBe(false);
        if (deletion.status === "fulfilled") outcomes.deleted += 1;
        if (publication.status === "fulfilled") outcomes.published += 1;
        await reset();
      }
      expect(outcomes.deleted + outcomes.published).toBeGreaterThan(0);
    });
  });
});
