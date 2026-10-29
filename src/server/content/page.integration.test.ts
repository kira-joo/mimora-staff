// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { PageModel } from "./page.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await PageModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("Page", () => {
  it("defaults to unpublished and persists localized content", async () => {
    const page = await PageModel.create({
      slug: "about",
      title: { en: "About Us", ar: "من نحن" },
      content: { en: "We sell things.", ar: "نحن نبيع أشياء." },
    });

    expect(page.published).toBe(false);
    expect(page.title.en).toBe("About Us");
  });

  it("enforces slug uniqueness — the storefront pages/[slug] route depends on this", async () => {
    await PageModel.create({ slug: "contact", title: { en: "x", ar: "x" }, content: { en: "x", ar: "x" } });
    await expect(PageModel.create({ slug: "contact", title: { en: "y", ar: "y" }, content: { en: "y", ar: "y" } })).rejects.toThrow();
  });

  it("carries its own SEO override, matching StoreProfile.defaultSeo's shape", async () => {
    const page = await PageModel.create({
      slug: "legal",
      title: { en: "Legal", ar: "قانوني" },
      content: { en: "x", ar: "x" },
      seo: { title: { en: "Legal — Store", ar: "قانوني — المتجر" } },
    });

    expect(page.seo.title?.en).toBe("Legal — Store");
  });
});
