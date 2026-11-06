import mongoose from "mongoose";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { StoreProfileModel } from "src/server/content/store-profile.schema";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * `PUT /api/admin/store-profile` end to end — it had no integration test. The round trip (what is sent is what is
 * read back, Arabic included), a partial patch leaving the rest alone, an image slot set to `null` being removed
 * and destroyed only after the write, and the permission negative.
 */
const provider = vi.hoisted(() => ({
  destroyed: [] as string[],
  destroyAsset: async (publicId: string) => {
    provider.destroyed.push(publicId);
  },
}));
vi.mock("src/server/core/assets/asset-providers", () => ({ assetProvider: () => provider }));
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { GET, PUT } = (await import("./route")) as unknown as { GET: RouteHandler; PUT: RouteHandler };

const image = (publicId: string): ImageAsset => ({ provider: "cloudinary" as ImageAsset["provider"], publicId, secureUrl: `https://res.example/${publicId}.png`, format: "png", width: 600, height: 315, bytes: 2000 });

const FULL = {
  name: { ar: "متجر الزيتون", en: "Olive Store" },
  tagline: { ar: "طازج كل يوم", en: "Fresh daily" },
  description: { ar: "وصف المتجر بالعربية", en: "About the store" },
  contact: { phone: "+201000000000", email: "hello@example.com", whatsApp: "+201000000001" },
  socialLinks: [{ platform: "Instagram", url: "https://instagram.com/olive" }],
  currency: "EGP",
  defaultLocale: "ar",
  supportedLocales: ["ar", "en"],
  defaultSeo: { title: { ar: "عنوان", en: "Title" }, description: { ar: "وصف", en: "Description" } },
};

let owner: AdminCaller;
const put = (body: unknown, caller = owner) => caller.call(PUT, "/api/admin/store-profile", { method: "PUT", body });
const get = async (caller = owner) => (await caller.call(GET, "/api/admin/store-profile")).json();
/** The slice of the raw stored document these assertions read. */
type StoredProfile = { name?: unknown; logo?: unknown; defaultSeo: { title?: unknown; description?: unknown; ogImage: { publicId: string } } };
const stored = () => StoreProfileModel.collection.findOne({}) as unknown as Promise<StoredProfile | null>;

beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await Promise.all([removeHarnessStaff(), StoreProfileModel.deleteMany({})]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  provider.destroyed.length = 0;
  await StoreProfileModel.deleteMany({});
});

describe("store profile round trip", () => {
  it("what is saved is what is read back, Arabic intact", async () => {
    const response = await put(FULL);
    expect(response.status).toBe(200);
    const read = await get();
    expect(read).toMatchObject({ ...FULL });
    expect(read.name.ar).toBe("متجر الزيتون");
  });

  it("a partial patch changes only what it names", async () => {
    await put(FULL);
    await put({ tagline: { ar: "جديد", en: "New" } });
    const read = await get();
    expect(read.tagline).toEqual({ ar: "جديد", en: "New" });
    expect(read.name).toEqual(FULL.name);
    expect(read.contact).toMatchObject(FULL.contact);
    expect(read.defaultSeo.title).toEqual(FULL.defaultSeo.title);
  });

  it("clearing a default-SEO field removes it without touching the other", async () => {
    await put(FULL);
    await put({ defaultSeo: { title: { ar: "عنوان", en: "Title" } } });
    const doc = await stored();
    expect(doc?.defaultSeo.title).toEqual({ ar: "عنوان", en: "Title" });
    expect("description" in (doc?.defaultSeo ?? {})).toBe(false);
  });

  it("refuses defaultSeo.ogImage: the OG image is the profile's own ogImage, the field the storefront reads", async () => {
    const response = await put({ defaultSeo: { ogImage: image("store/store-profile/x") } });
    expect(response.status).toBe(400);
  });

  it("leaves a legacy defaultSeo.ogImage already on the document untouched by a title edit", async () => {
    await StoreProfileModel.collection.insertOne({ defaultSeo: { ogImage: image("store/legacy/og") }, currency: "EGP" });
    await put({ defaultSeo: { title: { ar: "ع", en: "T" } } });
    expect((await stored())?.defaultSeo.ogImage.publicId).toBe("store/legacy/og");
  });
});

describe("store-identity images", () => {
  it("saves logo, favicon, ogImage and heroMedia, and reads them back", async () => {
    await put({ ...FULL, logo: image("store/store-profile/logo"), favicon: image("store/store-profile/fav"), ogImage: image("store/store-profile/og"), heroMedia: image("store/store-profile/hero") });
    const read = await get();
    expect(read.logo.publicId).toBe("store/store-profile/logo");
    expect(read.favicon.secureUrl).toContain("fav");
    expect(read.ogImage.publicId).toBe("store/store-profile/og");
    expect(read.heroMedia.width).toBe(600);
  });

  it("replacing an image destroys the old asset after the write; the other slots are untouched", async () => {
    await put({ logo: image("store/store-profile/logo-1"), heroMedia: image("store/store-profile/hero") });
    provider.destroyed.length = 0;
    await put({ logo: image("store/store-profile/logo-2") });
    expect(provider.destroyed).toEqual(["store/store-profile/logo-1"]);
    expect((await get()).heroMedia.publicId).toBe("store/store-profile/hero");
  });

  it("null removes the slot (unset in the database) and destroys the asset", async () => {
    await put({ ogImage: image("store/store-profile/og-1") });
    provider.destroyed.length = 0;
    const response = await put({ ogImage: null });
    expect(response.status).toBe(200);
    expect(provider.destroyed).toEqual(["store/store-profile/og-1"]);
    expect("ogImage" in ((await stored()) ?? {})).toBe(false);
  });

  it("a save that leaves images out destroys nothing", async () => {
    await put({ logo: image("store/store-profile/logo-1") });
    provider.destroyed.length = 0;
    await put({ name: { ar: "ا", en: "A" } });
    expect(provider.destroyed).toEqual([]);
    expect((await get()).logo.publicId).toBe("store/store-profile/logo-1");
  });

  it("a malformed image record is refused with 400 and nothing is written", async () => {
    const response = await put({ logo: { publicId: "store/store-profile/x" } });
    expect(response.status).toBe(400);
    expect(await stored()).toBeNull();
  });
});

describe("permissions — the negative cases", () => {
  it("StoreProfile.read alone may read but not write: the PUT is refused (403) and nothing changes", async () => {
    await put(FULL);
    const reader = await signInWithPermissions([AppPermission.STORE_PROFILE.READ]);
    expect((await reader.call(GET, "/api/admin/store-profile")).status).toBe(200);
    const response = await put({ name: { ar: "اختراق", en: "Hacked" }, logo: image("store/store-profile/evil") }, reader);
    expect(response.status).toBe(403);
    const doc = await stored();
    expect(doc?.name).toEqual(FULL.name);
    expect(doc?.logo).toBeUndefined();
    expect(provider.destroyed).toEqual([]);
  });

  it("an unrelated permission cannot read or write it", async () => {
    const other = await signInWithPermissions([AppPermission.PRODUCT.UPDATE]);
    expect((await other.call(GET, "/api/admin/store-profile")).status).toBe(403);
    expect((await put(FULL, other)).status).toBe(403);
  });
});
