import mongoose from "mongoose";
import { toMoney, type ImageAsset } from "@kira-joo/toolkit-common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { ProductGroupModel } from "src/server/catalog/product-group.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { getProductDetail } from "src/server/storefront/get-product-detail";
import { STALE_GROUP_MESSAGE } from "src/server/admin/product-groups/set-product-group-members";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * Product groups through their real routes (auth, permissions, DTO validation, transactions, revalidation) against a
 * real database, and what the storefront then shows. Only the storefront's revalidation receiver is stubbed.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

type Routes = Record<"GET" | "POST" | "PUT" | "DELETE", RouteHandler>;
const groups = (await import("./route")) as unknown as Routes;
const group = (await import("./[id]/route")) as unknown as Routes;
const members = (await import("./[id]/members/route")) as unknown as Routes;
const product = (await import("../products/[id]/route")) as unknown as Routes;
const lifecycle = (await import("../products/[id]/lifecycle/route")) as unknown as Routes;

const L = (en: string, ar: string) => ({ en, ar });
const image = (publicId: string): ImageAsset => ({ provider: "cloudinary" as ImageAsset["provider"], publicId, secureUrl: `https://res.example/${publicId}.png`, format: "png", width: 400, height: 400, bytes: 1000 });
const realFetch = globalThis.fetch;
const revalidations: string[][] = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

let owner: AdminCaller;
let categoryId: mongoose.Types.ObjectId;
const wipe = () => Promise.all([ProductModel.deleteMany({}), ProductGroupModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({})]);

beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await Promise.all([wipe(), removeHarnessStaff()]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await wipe();
  categoryId = (await CategoryModel.create({ slug: "slippers", published: true }))._id;
  revalidations.length = 0;
  process.env.STOREFRONT_REVALIDATE_URL = "http://storefront.test/api/revalidate";
  process.env.REVALIDATE_SECRET = "test-revalidate-secret";
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("http://storefront.test/")) {
      revalidations.push((JSON.parse(String(init?.body)) as { tags: string[] }).tags);
      return new Response(null, { status: 200 });
    }
    return realFetch(url, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

/** A real, complete product with its own variants (S/M), gallery and price — what grouping must never touch. */
async function seedProduct(slug: string, lifecycleState: "draft" | "published" | "archived" = "published") {
  const created = await ProductModel.create({
    slug,
    categoryId,
    lifecycle: lifecycleState,
    name: L(`${slug} slippers`, `شبشب ${slug}`),
    description: L("Soft.", "ناعم."),
    images: [image(`mimora/store/products/${slug}`)],
    optionAxes: [{ key: "size", name: L("Size", "المقاس") }],
  });
  await VariantModel.create([
    { productId: created._id, sku: `${slug}-S`, variantKey: `${slug}-s`, optionValues: [{ key: "size", value: "S" }], price: toMoney("250.00"), stock: 3 },
    { productId: created._id, sku: `${slug}-M`, variantKey: `${slug}-m`, optionValues: [{ key: "size", value: "M" }], price: toMoney("260.00"), stock: 0 },
  ]);
  return created._id.toString();
}

const json = async (response: Response) => ({ status: response.status, body: response.status === 204 ? null : await response.json() });
const createGroup = async (name = L("Plush Bow Slippers", "شباشب الفيونكة"), caller = owner) => json(await caller.call(groups.POST, "/api/admin/product-groups", { method: "POST", body: { name } }));
const readGroup = async (id: string, caller = owner) => json(await caller.call(group.GET, `/api/admin/product-groups/${id}`, { params: { id } }));
const setMembers = async (id: string, expectedRevision: number, list: Array<{ productId: string; label: { en: string; ar: string } }>, caller = owner) =>
  json(await caller.call(members.PUT, `/api/admin/product-groups/${id}/members`, { method: "PUT", params: { id }, body: { expectedRevision, members: list } }));
const deleteGroup = async (id: string, caller = owner) => json(await caller.call(group.DELETE, `/api/admin/product-groups/${id}`, { method: "DELETE", params: { id } }));
const stored = async (id: string) => ProductModel.findById(id).lean();
/** Everything about a product except its group membership — must not change when grouping changes. */
const productFacts = async (id: string) => {
  const product: Record<string, unknown> = { ...(await stored(id))! };
  delete product.group;
  return { product, variants: await VariantModel.find({ productId: id }).sort({ sku: 1 }).lean() };
};

describe("creating and naming a group", () => {
  it("creates an empty group, with no storefront invalidation", async () => {
    const { status, body } = await createGroup();
    expect(status).toBeLessThan(300);
    expect(body).toMatchObject({ name: L("Plush Bow Slippers", "شباشب الفيونكة"), revision: 0, members: [] });
    await settle();
    expect(revalidations).toEqual([]);
  });

  it("refuses a group with no name in either language (400), and writes nothing", async () => {
    expect((await createGroup(L(" ", ""))).status).toBe(400);
    expect(await ProductGroupModel.countDocuments({})).toBe(0);
  });

  it("a name with one language omitted is a validation answer, never a crash", async () => {
    const result = await json(await owner.call(groups.POST, "/api/admin/product-groups", { method: "POST", body: { name: { en: "Only English" } } }));
    expect([200, 201, 400]).toContain(result.status);
    if (result.status < 300) expect(result.body.name).toEqual(L("Only English", ""));
  });

  it("renames without changing the revision", async () => {
    const { body } = await createGroup();
    const renamed = await json(await owner.call(group.PUT, `/api/admin/product-groups/${body._id}`, { method: "PUT", params: { id: body._id }, body: { name: L("Bow Slippers", "شباشب") } }));
    expect(renamed.body).toMatchObject({ name: L("Bow Slippers", "شباشب"), revision: 0 });
  });

  it("lists groups with their member counts", async () => {
    const a = (await createGroup(L("A", "أ"))).body;
    await createGroup(L("B", "ب"));
    await setMembers(a._id, 0, [{ productId: await seedProduct("brown"), label: L("Brown", "بني") }]);
    const list = await json(await owner.call(groups.GET, "/api/admin/product-groups", {}));
    expect(list.body.data.map((g: { name: { en: string }; memberCount: number }) => [g.name.en, g.memberCount]).sort()).toEqual([
      ["A", 1],
      ["B", 0],
    ]);
  });
});

describe("membership", () => {
  it("adds products in order with their labels; each product keeps everything else; publishes PRODUCTS once", async () => {
    const [brown, pink, cream] = [await seedProduct("brown"), await seedProduct("pink"), await seedProduct("cream")];
    const before = await Promise.all([brown, pink, cream].map(productFacts));
    const { body: created } = await createGroup();

    const saved = await setMembers(created._id, 0, [
      { productId: pink, label: L(" Pink ", "وردي") },
      { productId: brown, label: L("Brown", "بني") },
      { productId: cream, label: L("Cream", "كريمي") },
    ]);

    expect(saved.status).toBe(200);
    expect(saved.body.revision).toBe(1);
    expect(saved.body.members.map((m: { productId: string; label: { en: string }; order: number }) => [m.productId, m.label.en, m.order])).toEqual([
      [pink, "Pink", 0],
      [brown, "Brown", 1],
      [cream, "Cream", 2],
    ]);
    expect(await Promise.all([brown, pink, cream].map(productFacts))).toEqual(before);
    await vi.waitFor(() => expect(revalidations).toEqual([["PRODUCTS"]]));
  });

  it("reorders, relabels and removes in one save; a removed product is simply ungrouped", async () => {
    const [brown, pink, cream] = [await seedProduct("brown"), await seedProduct("pink"), await seedProduct("cream")];
    const { body: created } = await createGroup();
    await setMembers(created._id, 0, [
      { productId: brown, label: L("Brown", "بني") },
      { productId: pink, label: L("Pink", "وردي") },
      { productId: cream, label: L("Cream", "كريمي") },
    ]);
    const creamBefore = await productFacts(cream);

    const saved = await setMembers(created._id, 1, [
      { productId: pink, label: L("Rose", "زهري") },
      { productId: brown, label: L("Brown", "بني") },
    ]);

    expect(saved.body.members.map((m: { productId: string; label: { en: string } }) => [m.productId, m.label.en])).toEqual([
      [pink, "Rose"],
      [brown, "Brown"],
    ]);
    expect((await stored(cream))?.group).toBeUndefined();
    expect(await productFacts(cream)).toEqual(creamBefore);
  });

  it("moves a product from another group, and that group's revision moves on so its stale editor is refused", async () => {
    const brown = await seedProduct("brown");
    const pink = await seedProduct("pink");
    const a = (await createGroup(L("A", "أ"))).body;
    const b = (await createGroup(L("B", "ب"))).body;
    await setMembers(a._id, 0, [
      { productId: brown, label: L("Brown", "بني") },
      { productId: pink, label: L("Pink", "وردي") },
    ]);

    const moved = await setMembers(b._id, 0, [{ productId: pink, label: L("Pink", "وردي") }]);
    expect(moved.status).toBe(200);

    const groupA = (await readGroup(a._id)).body;
    expect(groupA.members.map((m: { productId: string }) => m.productId)).toEqual([brown]);
    expect(groupA.revision).toBe(2);
    expect((await stored(pink))?.group?.groupId.toString()).toBe(b._id);
    // An editor that loaded group A before the move must not put pink back.
    const stale = await setMembers(a._id, 1, [
      { productId: brown, label: L("Brown", "بني") },
      { productId: pink, label: L("Pink", "وردي") },
    ]);
    expect(stale.status).toBe(409);
    expect((await stored(pink))?.group?.groupId.toString()).toBe(b._id);
  });

  it("refuses a save built from a stale read (409) and changes nothing", async () => {
    const brown = await seedProduct("brown");
    const pink = await seedProduct("pink");
    const { body: created } = await createGroup();
    await setMembers(created._id, 0, [{ productId: brown, label: L("Brown", "بني") }]);
    revalidations.length = 0;

    const stale = await setMembers(created._id, 0, [{ productId: pink, label: L("Pink", "وردي") }]);

    expect(stale.status).toBe(409);
    expect(stale.body.message).toBe(STALE_GROUP_MESSAGE);
    expect((await stored(brown))?.group?.groupId.toString()).toBe(created._id);
    expect((await stored(pink))?.group).toBeUndefined();
    await settle();
    expect(revalidations).toEqual([]);
  });

  it.each([
    ["a missing label", (p: string) => [{ productId: p, label: L("Brown", "") }]],
    ["the same product twice", (p: string) => [
      { productId: p, label: L("Brown", "بني") },
      { productId: p, label: L("Pink", "وردي") },
    ]],
    ["two products with one label", (p: string, q: string) => [
      { productId: p, label: L("Brown", "بني") },
      { productId: q, label: L("brown", "وردي") },
    ]],
  ])("refuses %s (400) and changes nothing", async (_label, build) => {
    const brown = await seedProduct("brown");
    const pink = await seedProduct("pink");
    const { body: created } = await createGroup();
    const result = await setMembers(created._id, 0, build(brown, pink));
    expect(result.status).toBe(400);
    expect((await readGroup(created._id)).body).toMatchObject({ revision: 0, members: [] });
  });

  it("refuses a product that does not exist (404) and rolls back the whole save", async () => {
    const brown = await seedProduct("brown");
    const { body: created } = await createGroup();
    const result = await setMembers(created._id, 0, [
      { productId: brown, label: L("Brown", "بني") },
      { productId: new mongoose.Types.ObjectId().toString(), label: L("Ghost", "شبح") },
    ]);
    expect(result.status).toBe(404);
    expect((await stored(brown))?.group).toBeUndefined();
    expect((await readGroup(created._id)).body.revision).toBe(0);
  });

  it("refuses a group that does not exist (404)", async () => {
    const result = await setMembers(new mongoose.Types.ObjectId().toString(), 0, []);
    expect(result.status).toBe(404);
  });
});

describe("product edits and lifecycle keep membership", () => {
  it("editing a product's content, archiving and re-publishing it never drops its group", async () => {
    const brown = await seedProduct("brown");
    const { body: created } = await createGroup();
    await setMembers(created._id, 0, [{ productId: brown, label: L("Brown", "بني") }]);

    expect((await owner.call(product.PUT, `/api/admin/products/${brown}`, { method: "PUT", params: { id: brown }, body: { name: L("Brown Bow Slippers", "شبشب بني") } })).status).toBe(200);
    expect((await owner.call(product.DELETE, `/api/admin/products/${brown}`, { method: "DELETE", params: { id: brown } })).status).toBeLessThan(300);
    expect((await stored(brown))?.lifecycle).toBe("archived");
    expect((await stored(brown))?.group?.label).toEqual(L("Brown", "بني"));

    expect((await owner.call(lifecycle.PUT, `/api/admin/products/${brown}/lifecycle`, { method: "PUT", params: { id: brown }, body: { lifecycle: "published" } })).status).toBe(200);
    expect((await stored(brown))?.group?.groupId.toString()).toBe(created._id);
  });
});

describe("deleting a group", () => {
  it("deletes the group and ungroups its members — every product and variant is kept as it was", async () => {
    const [brown, pink] = [await seedProduct("brown"), await seedProduct("pink", "archived")];
    const { body: created } = await createGroup();
    await setMembers(created._id, 0, [
      { productId: brown, label: L("Brown", "بني") },
      { productId: pink, label: L("Pink", "وردي") },
    ]);
    const before = await Promise.all([brown, pink].map(productFacts));
    revalidations.length = 0;

    expect((await deleteGroup(created._id)).status).toBeLessThan(300);

    expect(await ProductGroupModel.countDocuments({})).toBe(0);
    expect(await ProductModel.countDocuments({ _id: { $in: [brown, pink] } })).toBe(2);
    expect((await stored(brown))?.group).toBeUndefined();
    expect(await Promise.all([brown, pink].map(productFacts))).toEqual(before);
    await vi.waitFor(() => expect(revalidations).toEqual([["PRODUCTS"]]));
  });

  it("a group already deleted is a 404, and publishes nothing", async () => {
    const { body: created } = await createGroup();
    await deleteGroup(created._id);
    revalidations.length = 0;
    expect((await deleteGroup(created._id)).status).toBe(404);
    await settle();
    expect(revalidations).toEqual([]);
  });

  it("a membership save against a deleted group is a 404 and attaches nothing", async () => {
    const brown = await seedProduct("brown");
    const { body: created } = await createGroup();
    await deleteGroup(created._id);
    expect((await setMembers(created._id, 0, [{ productId: brown, label: L("Brown", "بني") }])).status).toBe(404);
    expect((await stored(brown))?.group).toBeUndefined();
  });
});

describe("permissions", () => {
  it.each([
    ["no permissions", []],
    ["read only", [AppPermission.PRODUCT_GROUP.READ, AppPermission.PRODUCT_GROUP.READ_ONE]],
    ["full product rights but none on groups", [AppPermission.PRODUCT.READ, AppPermission.PRODUCT.READ_ONE, AppPermission.PRODUCT.CREATE, AppPermission.PRODUCT.UPDATE, AppPermission.PRODUCT.DELETE]],
  ])("NEGATIVE: %s cannot create, rename, change membership or delete (403), and nothing changes", async (_label, keys) => {
    const brown = await seedProduct("brown");
    const { body: created } = await createGroup();
    const staff = await signInWithPermissions(keys);

    expect((await createGroup(L("X", "س"), staff)).status).toBe(403);
    expect((await staff.call(group.PUT, `/api/admin/product-groups/${created._id}`, { method: "PUT", params: { id: created._id }, body: { name: L("X", "س") } })).status).toBe(403);
    expect((await setMembers(created._id, 0, [{ productId: brown, label: L("Brown", "بني") }], staff)).status).toBe(403);
    expect((await deleteGroup(created._id, staff)).status).toBe(403);

    expect(await ProductGroupModel.countDocuments({})).toBe(1);
    expect((await readGroup(created._id)).body).toMatchObject({ name: L("Plush Bow Slippers", "شباشب الفيونكة"), revision: 0, members: [] });
    owner = await signInAsOwner();
  });

  it("NEGATIVE: without read permission the group cannot be listed or opened", async () => {
    const { body: created } = await createGroup();
    const staff = await signInWithPermissions([AppPermission.PRODUCT.READ]);
    expect((await staff.call(groups.GET, "/api/admin/product-groups", {})).status).toBe(403);
    expect((await readGroup(created._id, staff)).status).toBe(403);
    owner = await signInAsOwner();
  });

  it("the ProductGroup permissions alone are enough to manage membership", async () => {
    const brown = await seedProduct("brown");
    const staff = await signInWithPermissions(Object.values(AppPermission.PRODUCT_GROUP));
    const { status, body } = await createGroup(L("G", "ج"), staff);
    expect(status).toBeLessThan(300);
    expect((await setMembers(body._id, 0, [{ productId: brown, label: L("Brown", "بني") }], staff)).status).toBe(200);
    owner = await signInAsOwner();
  });
});

describe("storefront product page", () => {
  it("offers the group's published members in group order, current one marked; drafts and archived members are left out", async () => {
    const [brown, pink, cream, grey] = [await seedProduct("brown"), await seedProduct("pink"), await seedProduct("cream", "draft"), await seedProduct("grey", "archived")];
    const { body: created } = await createGroup();
    await setMembers(created._id, 0, [
      { productId: pink, label: L("Pink", "وردي") },
      { productId: cream, label: L("Cream", "كريمي") },
      { productId: brown, label: L("Brown", "بني") },
      { productId: grey, label: L("Grey", "رمادي") },
    ]);

    const detail = await getProductDetail("brown");
    expect(detail.linkedProducts?.items.map((item) => [item.slug, item.label.en, item.label.ar, item.current])).toEqual([
      ["pink", "Pink", "وردي", false],
      ["brown", "Brown", "بني", true],
    ]);
    expect(detail.linkedProducts?.items[0]?.image?.publicId).toBe("mimora/store/products/pink");
    // The product's own variants are unaffected by being grouped.
    expect(detail.variants.map((variant) => variant.sku).sort()).toEqual(["brown-M", "brown-S"]);
    expect((await getProductDetail("pink")).linkedProducts?.items.find((item) => item.current)?.slug).toBe("pink");
  });

  it("an ungrouped product, and a group with no other published member, show no alternatives", async () => {
    await seedProduct("solo");
    expect((await getProductDetail("solo")).linkedProducts).toBeNull();

    const brown = await seedProduct("brown");
    const pink = await seedProduct("pink", "draft");
    const { body: created } = await createGroup();
    await setMembers(created._id, 0, [
      { productId: brown, label: L("Brown", "بني") },
      { productId: pink, label: L("Pink", "وردي") },
    ]);
    expect((await getProductDetail("brown")).linkedProducts).toBeNull();
  });

  it("after the group is deleted, its former members show no alternatives", async () => {
    const [brown, pink] = [await seedProduct("brown"), await seedProduct("pink")];
    const { body: created } = await createGroup();
    await setMembers(created._id, 0, [
      { productId: brown, label: L("Brown", "بني") },
      { productId: pink, label: L("Pink", "وردي") },
    ]);
    expect((await getProductDetail("brown")).linkedProducts?.items).toHaveLength(2);
    await deleteGroup(created._id);
    expect((await getProductDetail("brown")).linkedProducts).toBeNull();
  });
});

describe("schema", () => {
  it("DECLARES the index the storefront's sibling lookup uses", () => {
    expect(ProductModel.schema.indexes().some(([keys]) => JSON.stringify(keys) === JSON.stringify({ "group.groupId": 1 }))).toBe(true);
  });
});
