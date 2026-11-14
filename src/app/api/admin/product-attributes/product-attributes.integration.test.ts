import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { getFacets } from "src/server/storefront/get-facets";
import type { AttributeCatalogEntry } from "src/api/product-attributes.endpoints";
import type { Product } from "src/api/products.endpoints";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * The derived attribute catalog (`GET /api/admin/product-attributes`) and the console guard that keeps a NEW attribute
 * from taking an existing attribute's name. Everything goes through the real route handlers: DTO validation, the
 * permission guard, the database.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const catalogRoute = ((await import("./route")) as unknown as Record<"GET", RouteHandler>).GET;
const createRoute = ((await import("../products/route")) as unknown as Record<"POST", RouteHandler>).POST;
const updateRoute = ((await import("../products/[id]/route")) as unknown as Record<"PUT", RouteHandler>).PUT;

const L = (en: string, ar: string) => ({ en, ar });
const attr = (key: string, name: { en: string; ar: string }, values: Array<[string, { en: string; ar: string }]>) => ({ key, name, values: values.map(([k, value]) => ({ key: k, value })) });

let owner: AdminCaller;
let categoryId: string;
let counter = 0;

const wipe = () => Promise.all([ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({})]);
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
  categoryId = (await CategoryModel.create({ slug: "necklaces", published: true }))._id.toString();
});

type AttributeInput = ReturnType<typeof attr>;
const body = (attributes: AttributeInput[]) => {
  counter += 1;
  return {
    name: L(`Pendant ${counter}`, `قلادة ${counter}`),
    description: L("", ""),
    slug: `pendant-${counter}`,
    categoryId,
    collectionIds: [],
    optionAxes: [],
    attributes,
    seoTitle: L("", ""),
    seoDescription: L("", ""),
  };
};
const create = async (attributes: AttributeInput[], caller: AdminCaller = owner) => {
  const response = await caller.call(createRoute, "/api/admin/products", { method: "POST", body: body(attributes) });
  return { status: response.status, json: (await response.json()) as Product & { message?: string } };
};
const catalog = async (caller: AdminCaller = owner) => {
  const response = await caller.call(catalogRoute, "/api/admin/product-attributes");
  return { status: response.status, data: ((await response.json()) as { data: AttributeCatalogEntry[] }).data };
};

describe("GET /api/admin/product-attributes", () => {
  it("is empty for a store with no attributes", async () => {
    expect(await catalog()).toEqual({ status: 200, data: [] });
  });

  it("derives one entry per key from every product, any lifecycle, with usage counts", async () => {
    await create([attr("material", L("Material", "الخامة"), [["gold", L("Gold", "ذهب")]])]);
    await ProductModel.create({ ...body([attr("material", L("Material", "الخامة"), [["gold", L("Gold", "ذهب")], ["silver", L("Silver", "فضة")]]), attr("fit", L("Fit", "القصة"), [["slim", L("Slim", "ضيق")]])]), lifecycle: "archived" });

    const { status, data } = await catalog();
    expect(status).toBe(200);
    expect(data.map((entry) => [entry.key, entry.productCount])).toEqual([["fit", 1], ["material", 2]]);
    const material = data.find((entry) => entry.key === "material")!;
    expect(material.name).toEqual(L("Material", "الخامة"));
    expect(material.values.map((value) => [value.key, value.productCount])).toEqual([["gold", 2], ["silver", 1]]);
  });

  it("NEGATIVE: without Product.read it is refused", async () => {
    const writer = await signInWithPermissions([AppPermission.PRODUCT.CREATE]);
    expect((await catalog(writer)).status).toBe(403);
    owner = await signInAsOwner();
  });
});

describe("console create — attribute identity", () => {
  it("accepts an existing attribute key, and two products can share it with different values", async () => {
    const first = await create([attr("material", L("Material", "الخامة"), [["gold", L("Gold", "ذهب")]])]);
    const second = await create([attr("material", L("Material", "الخامة"), [["silver", L("Silver", "فضة")]])]);
    expect([first.status, second.status].every((status) => status < 300)).toBe(true);

    const [entry] = (await catalog()).data;
    expect(entry!.key).toBe("material");
    expect(entry!.productCount).toBe(2);
    expect(entry!.values.map((value) => value.key)).toEqual(["gold", "silver"]);
  });

  it("accepts a genuinely new attribute", async () => {
    await create([attr("material", L("Material", "الخامة"), [["gold", L("Gold", "ذهب")]])]);
    const { status } = await create([attr("stone", L("Stone", "الحجر"), [["zircon", L("Zircon", "زركون")]])]);
    expect(status).toBeLessThan(300);
    expect((await catalog()).data.map((entry) => entry.key)).toEqual(["material", "stone"]);
  });

  it("refuses (400) a new key whose name exactly duplicates an existing name, and writes nothing", async () => {
    await create([attr("color", L("Color", "اللون"), [["red", L("Red", "أحمر")]])]);
    const before = await ProductModel.countDocuments({});

    const byEnglish = await create([attr("colours", L("Colors", ""), [["red", L("Red", "أحمر")]])]);
    expect(byEnglish.status).toBe(400);
    expect(byEnglish.json.message).toContain('already exists (key "color") — select it instead.');

    const byArabic = await create([attr("alwan", L("", "لون"), [["red", L("Red", "أحمر")]])]);
    expect(byArabic.status).toBe(400);

    expect(await ProductModel.countDocuments({})).toBe(before);
    expect((await catalog()).data.map((entry) => entry.key)).toEqual(["color"]);
  });

  it("does not refuse a merely near name — that is the editor's warning, not a server rule", async () => {
    await create([attr("color", L("Color", "اللون"), [["red", L("Red", "أحمر")]])]);
    expect((await create([attr("shade", L("Colorr", ""), [["red", L("Red", "أحمر")]])])).status).toBeLessThan(300);
  });

  it("NEGATIVE: the guard sits behind the permission check — a caller without Product.create is refused before anything is read", async () => {
    const reader = await signInWithPermissions([AppPermission.PRODUCT.READ]);
    expect((await create([attr("material", L("Material", "الخامة"), [["gold", L("Gold", "ذهب")]])], reader)).status).toBe(403);
    expect(await ProductModel.countDocuments({})).toBe(0);
    owner = await signInAsOwner();
  });
});

describe("console update — attribute identity", () => {
  const put = async (id: string, payload: Record<string, unknown>) => {
    const response = await owner.call(updateRoute, `/api/admin/products/${id}`, { method: "PUT", params: { id }, body: payload });
    return { status: response.status, json: (await response.json()) as Product & { message?: string } };
  };

  it("saving a legacy product with its existing attributes unchanged passes, even if its name now collides with another key", async () => {
    // Legacy data the guard must never trap: two keys already carry the same name, written before any guard existed.
    const legacy = await ProductModel.create({ ...body([attr("colour", L("Color", ""), [["red", L("Red", "")]])]), slug: "legacy" });
    await ProductModel.create({ ...body([attr("color", L("Color", "اللون"), [["red", L("Red", "")]])]), slug: "other" });

    const { status } = await put(legacy._id.toString(), { attributes: [attr("colour", L("Color", ""), [["red", L("Red", "")], ["blue", L("Blue", "")]])] });
    expect(status).toBeLessThan(300);
    expect((await ProductModel.findById(legacy._id).lean())!.attributes[0]!.values.map((value) => value.key)).toEqual(["red", "blue"]);
  });

  it("refuses adding a new duplicate-named attribute to a product (400), leaving the product as it was", async () => {
    const { json: created } = await create([attr("color", L("Color", "اللون"), [["red", L("Red", "")]])]);
    const before = await ProductModel.findById(created._id).lean();

    const { status } = await put(created._id, { attributes: [attr("color", L("Color", "اللون"), [["red", L("Red", "")]]), attr("hue", L("Hue", "اللون"), [["x", L("X", "")]])] });
    expect(status).toBe(400);
    expect(await ProductModel.findById(created._id).lean()).toEqual(before);
  });

  it("an update that does not send attributes is untouched by the guard", async () => {
    const { json: created } = await create([attr("color", L("Color", "اللون"), [["red", L("Red", "")]])]);
    const { status, json } = await put(created._id, { name: L("Renamed", "اسم جديد") });
    expect(status).toBeLessThan(300);
    expect(json.name.en).toBe("Renamed");
  });
});

describe("storefront facets still group by key", () => {
  it("counts products per attribute key and value, labelled from a published product", async () => {
    await create([attr("material", L("Material", "الخامة"), [["gold", L("Gold", "ذهب")]])]);
    await create([attr("material", L("Material", "الخامة"), [["gold", L("Gold", "ذهب")], ["silver", L("Silver", "فضة")]])]);
    await create([attr("fit", L("Fit", "القصة"), [["slim", L("Slim", "ضيق")]])]);
    await ProductModel.updateMany({}, { lifecycle: "published" });

    const facets = await getFacets();
    const material = facets.attributes.find((facet) => facet.key === "material")!;
    expect(facets.attributes.map((facet) => facet.key).sort()).toEqual(["fit", "material"]);
    expect(material.name).toEqual(L("Material", "الخامة"));
    expect(material.values.map((value) => [value.key, value.label.en, value.count]).sort()).toEqual([["gold", "Gold", 2], ["silver", "Silver", 1]]);
  });
});
