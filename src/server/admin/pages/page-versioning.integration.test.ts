import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { PageModel } from "../../content/page.schema";
import { PageRevisionModel } from "../../content/page-revision.schema";
import { createPage } from "./create-page";
import { updatePage } from "./update-page";

/**
 * D-13 (`store-platform/docs/legal-and-consent.md`): "terms pages are
 * versioned, and an edit creates a new version rather than mutating the old
 * one." An order records the version a customer accepted, so every version's
 * text must stay readable — and the page and its revision are written
 * together or not at all.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const V1 = { ar: "الشروط الأولى", en: "First terms" };
const V2 = { ar: "الشروط الثانية", en: "Second terms" };
const TITLE = { ar: "شروط البيع", en: "Terms of sale" };

const revisions = (pageId: mongoose.Types.ObjectId) => PageRevisionModel.find({ pageId }).sort({ version: 1 }).lean();

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await Promise.all([PageModel.deleteMany({}), PageRevisionModel.deleteMany({})]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([PageModel.deleteMany({}), PageRevisionModel.deleteMany({})]);
});

describe("page versions", () => {
  it("a new page is version 1, and its text is kept as revision 1", async () => {
    const page = await createPage({ slug: "terms", title: TITLE, content: V1, published: true });
    expect(page.version).toBe(1);

    const [revision, ...rest] = await revisions(page._id);
    expect(rest).toHaveLength(0);
    expect(revision).toMatchObject({ version: 1, slug: "terms", content: V1, title: TITLE });
  });

  it("an edit to the text is a new version, and the old text survives", async () => {
    const page = await createPage({ slug: "terms", title: TITLE, content: V1, published: true });
    const updated = await updatePage(page._id.toString(), { content: V2 });

    expect(updated.version).toBe(2);
    expect(updated.content).toMatchObject(V2);
    expect((await revisions(page._id)).map((r) => [r.version, r.content.en])).toEqual([
      [1, V1.en],
      [2, V2.en],
    ]);
  });

  it("a title change is a new version too", async () => {
    const page = await createPage({ slug: "terms", title: TITLE, content: V1 });
    expect((await updatePage(page._id.toString(), { title: { ar: "الشروط", en: "Terms" } })).version).toBe(2);
  });

  it("publishing, a slug or SEO change, or re-sending the same text, is not a new version", async () => {
    const page = await createPage({ slug: "terms", title: TITLE, content: V1 });
    const updated = await updatePage(page._id.toString(), { published: true, slug: "terms-of-sale", seo: { title: TITLE }, content: { ...V1 } });

    expect(updated.version).toBe(1);
    expect(await revisions(page._id)).toHaveLength(1);
  });

  it("a page written before versioning keeps its existing text as version 1 when first edited", async () => {
    // Raw insert: no `version` field and no revision, as in a pre-D-13 database.
    const { insertedId } = await PageModel.collection.insertOne({ slug: "terms", title: TITLE, content: V1, published: true, seo: {} });

    const updated = await updatePage(insertedId.toString(), { content: V2 });

    expect(updated.version).toBe(2);
    expect((await revisions(insertedId)).map((r) => [r.version, r.content.en])).toEqual([
      [1, V1.en],
      [2, V2.en],
    ]);
  });

  it("rolls back the page when its revision cannot be written — no version moves without its text", async () => {
    const page = await createPage({ slug: "terms", title: TITLE, content: V1, published: true });
    // Occupy revision 2's unique key so the revision write fails inside the transaction.
    await PageRevisionModel.create({ pageId: page._id, slug: "terms", version: 2, revisionKey: `${page._id.toString()}:2`, title: TITLE, content: { ar: "x", en: "x" } });

    await expect(updatePage(page._id.toString(), { content: V2 })).rejects.toThrow();

    const after = await PageModel.findById(page._id).lean();
    expect(after?.version).toBe(1);
    expect(after?.content).toMatchObject(V1);
  });
});
