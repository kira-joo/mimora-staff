import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { PageModel } from "../../content/page.schema";
import { listPages } from "./list-pages";
import { createPage } from "./create-page";
import { updatePage } from "./update-page";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { pageRevisionRepository } from "../../core/repositories";
import { PageRevisionModel } from "../../content/page-revision.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const injectedSpies: Array<{ mockRestore(): void }> = [];

afterEach(() => {
  while (injectedSpies.length > 0) injectedSpies.pop()!.mockRestore();
});

/**
 * Rollback-test injection. Lets the real write land, THEN fails the `nth` call
 * to `repo[method]` — so the rollback has a write that genuinely happened to
 * undo. Failing before the write would prove nothing about atomicity.
 */
function failAfterWrite(repo: object, method: string, nth = 1): void {
  const target = repo as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = target[method]!.bind(repo);
  let calls = 0;
  const spy = vi.spyOn(target, method).mockImplementation(async (...args: unknown[]) => {
    const result = await original(...args);
    calls += 1;
    if (calls === nth) throw new Error("injected failure");
    return result;
  });
  injectedSpies.push(spy);
}

const LOCALIZED = { ar: "نص", en: "Text" };

describe("Admin Pages", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await PageModel.deleteMany({});
  });

  afterEach(async () => {
    await PageModel.deleteMany({});
  });

  describe("createPage", () => {
    it("creates a page with defaults", async () => {
      const page = await createPage({ slug: "about", title: LOCALIZED, content: LOCALIZED });
      expect(page.published).toBe(false);
      expect(page.seo.title).toBeUndefined();
      expect(page.seo.description).toBeUndefined();
    });

    it("throws ConflictError on duplicate slug", async () => {
      await createPage({ slug: "about", title: LOCALIZED, content: LOCALIZED });
      await expect(createPage({ slug: "about", title: LOCALIZED, content: LOCALIZED })).rejects.toThrow(ConflictError);
    });
  });

  describe("createPage rollback", () => {
    it("the page insert is undone when its first revision cannot be written", async () => {
      await PageRevisionModel.deleteMany({});
      failAfterWrite(pageRevisionRepository, "save", 1); // the revision write, last in the transaction; it lands, then throws

      await expect(createPage({ slug: "rollback", title: LOCALIZED, content: LOCALIZED, published: true })).rejects.toThrow("injected failure");

      expect(await PageModel.countDocuments({})).toBe(0);
      expect(await PageRevisionModel.countDocuments({})).toBe(0);
    });
  });

  describe("updatePage", () => {
    it("updates content and merges seo", async () => {
      const created = await createPage({ slug: "about", title: LOCALIZED, content: LOCALIZED, seo: { title: LOCALIZED } });
      const updated = await updatePage(created._id.toString(), { published: true, seo: { description: LOCALIZED } });

      expect(updated.published).toBe(true);
      expect(updated.seo.title?.ar).toBe(LOCALIZED.ar);
      expect(updated.seo.title?.en).toBe(LOCALIZED.en);
      expect(updated.seo.description?.ar).toBe(LOCALIZED.ar);
      expect(updated.seo.description?.en).toBe(LOCALIZED.en);
    });

    it("throws ConflictError when updating to a duplicate slug", async () => {
      await createPage({ slug: "about", title: LOCALIZED, content: LOCALIZED });
      const other = await createPage({ slug: "contact", title: LOCALIZED, content: LOCALIZED });

      await expect(updatePage(other._id.toString(), { slug: "about" })).rejects.toThrow(ConflictError);
    });

    it("throws NotFoundError for a non-existent page", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(updatePage(fakeId, { published: true })).rejects.toThrow(NotFoundError);
    });
  });

  describe("listPages", () => {
    it("filters by published", async () => {
      await createPage({ slug: "about", title: LOCALIZED, content: LOCALIZED, published: true });
      await createPage({ slug: "contact", title: LOCALIZED, content: LOCALIZED, published: false });

      const published = await listPages({ limit: 10, page: 1, published: true });
      expect(published.total).toBe(1);
    });
  });
});
