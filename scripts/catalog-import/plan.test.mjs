import { describe, expect, it } from "vitest";
import { parseCatalog } from "./catalog.mjs";
import { buildPlan, productBody } from "./plan.mjs";
import { product } from "./test-fixtures.mjs";

const CAT = "6ae9bd7d431804dc15cf9991";
const COL = "6ae3c285750dd161bb65a05b";
const catalogOf = (products, groups = []) => parseCatalog({ products, productGroupAssignmentSteps: groups });
const groupStep = (members) => ({ groupName: { en: "Clips", ar: "كليبس" }, membersInStorefrontOrder: members.map((slug, i) => ({ productSlug: slug, label: { en: `L${i}`, ar: `ل${i}` } })) });
const imagesFor = (names, overrides = {}) => ({
  files: new Map(names.map((name) => [name, { name, exists: true, sha256: `sha-${name}`, mime: "image/jpeg", width: 1000, height: 1000, bytes: 1000, problem: null, ...overrides[name] }])),
  unused: [],
});
const remoteOf = (extra = {}) => ({ categories: new Set([CAT]), collections: new Set([COL]), productsBySlug: new Map(), skuOwner: new Map(), groupIds: new Set(), ...extra });
const emptyState = () => ({ images: {}, products: {}, groups: {} });

describe("buildPlan — products", () => {
  it("a fresh batch: every product created as a draft with its own image, its variants, then its lifecycle", () => {
    const plan = buildPlan({ catalog: catalogOf([product("a"), product("b", { product: { lifecycle: "draft" } })]), images: imagesFor(["a.jpg", "b.jpg"]), remote: remoteOf(), state: emptyState() });
    expect(plan.blocking).toEqual([]);
    expect(plan.products.map((p) => [p.slug, p.status, p.images.map((i) => `${i.filename}:${i.action}`).join(), p.variants.map((v) => v.action).join(), p.lifecycle.action])).toEqual([
      ["a", "create", "a.jpg:upload", "create", "set"],
      ["b", "create", "b.jpg:upload", "create", "none"],
    ]);
    expect(plan.summary).toMatchObject({ uploads: 2, variants: 2 });
  });

  it("productBody: the JSON product, as a draft, with exactly the uploaded images — the JSON lifecycle is applied afterwards", () => {
    const body = productBody(product("a").product, [{ publicId: "x" }]);
    expect(body).toMatchObject({ slug: "a", lifecycle: "draft", images: [{ publicId: "x" }], collectionIds: [COL] });
  });

  it("SKIPS a product whose slug exists but was not created by this importer, and never plans a write to it", () => {
    const remote = remoteOf({ productsBySlug: new Map([["a", { id: "p-existing", slug: "a", lifecycle: "published" }]]) });
    const plan = buildPlan({ catalog: catalogOf([product("a")]), images: imagesFor(["a.jpg"]), remote, state: emptyState() });
    expect(plan.products[0]).toMatchObject({ status: "skip", images: [{ action: "none" }], variants: [{ action: "none" }], lifecycle: { action: "none" } });
    expect(plan.warnings[0]).toContain("not created by this importer");
    expect(plan.blocking).toEqual([]);
  });

  it("RESUMES only what an earlier run of this importer left unfinished — no re-upload, existing variants kept", () => {
    const catalog = catalogOf([product("a", { variants: [{ sku: "A-1", optionValues: [], price: "1.00", stock: 1 }, { sku: "A-2", optionValues: [], price: "1.00", stock: 1 }] })]);
    const remote = remoteOf({ productsBySlug: new Map([["a", { id: "p1", slug: "a", lifecycle: "draft" }]]), skuOwner: new Map([["A-1", "p1"]]) });
    const state = { ...emptyState(), products: { a: { productId: "p1", variants: { "A-1": "v1" } } } };
    const plan = buildPlan({ catalog, images: imagesFor(["a.jpg"]), remote, state });
    expect(plan.products[0]).toMatchObject({ status: "resume", productId: "p1", images: [{ action: "none" }], lifecycle: { action: "set" } });
    expect(plan.products[0].variants.map((v) => `${v.sku}:${v.action}`)).toEqual(["A-1:exists", "A-2:create"]);
  });

  it("ADOPTS a product whose create response was lost — only when it carries the exact image that run uploaded", () => {
    const remote = (images) => remoteOf({ productsBySlug: new Map([["a", { id: "p1", slug: "a", lifecycle: "draft" }]]), imagesBySlug: new Map([["a", images]]) });
    const state = { ...emptyState(), products: { a: { variants: {}, pending: { imagePublicId: "mimora/store/products/up-1" } } } };
    const adopted = buildPlan({ catalog: catalogOf([product("a")]), images: imagesFor(["a.jpg"]), remote: remote(["mimora/store/products/up-1"]), state });
    expect(adopted.products[0]).toMatchObject({ status: "resume", productId: "p1", images: [{ action: "none" }] });
    const someoneElses = buildPlan({ catalog: catalogOf([product("a")]), images: imagesFor(["a.jpg"]), remote: remote(["mimora/store/products/other"]), state });
    expect(someoneElses.products[0].status).toBe("skip");
  });

  it("a completed product is DONE and left alone even if staff have changed it since", () => {
    const remote = remoteOf({ productsBySlug: new Map([["a", { id: "p1", slug: "a", lifecycle: "archived" }]]) });
    const state = { ...emptyState(), products: { a: { productId: "p1", variants: {}, completed: true } } };
    expect(buildPlan({ catalog: catalogOf([product("a")]), images: imagesFor(["a.jpg"]), remote, state }).products[0]).toMatchObject({ status: "done", lifecycle: { action: "none" } });
  });

  it("re-uses an image uploaded by an earlier run (same content hash) instead of uploading it again", () => {
    const state = { ...emptyState(), images: { "sha-a.jpg": { filename: "a.jpg", asset: { publicId: "mimora/store/products/a" } } } };
    const plan = buildPlan({ catalog: catalogOf([product("a")]), images: imagesFor(["a.jpg"]), remote: remoteOf(), state });
    expect(plan.products[0].images[0]).toMatchObject({ action: "reuse", asset: { publicId: "mimora/store/products/a" } });
    expect(plan.summary).toMatchObject({ uploads: 0, reusedUploads: 1 });
  });

  it.each([
    ["a missing image (with the folder's near match suggested, never used)", imagesFor(["a.jpg"], { "a.jpg": { exists: false, problem: "file not found", suggestion: "a (copy).jpg" } }), remoteOf(), 'image "a.jpg" file not found — did you mean "a (copy).jpg"?'],
    ["an image the server would refuse", imagesFor(["a.jpg"], { "a.jpg": { problem: "150×150 is below the 200px minimum" } }), remoteOf(), "is 150×150 is below the 200px minimum"],
    ["an unknown category", imagesFor(["a.jpg"]), remoteOf({ categories: new Set() }), `category ${CAT} does not exist`],
    ["an unknown collection", imagesFor(["a.jpg"]), remoteOf({ collections: new Set() }), `collection ${COL} does not exist`],
    ["a SKU another product already has", imagesFor(["a.jpg"]), remoteOf({ skuOwner: new Map([["SKU-a", "someone-else"]]) }), 'SKU "SKU-a" already belongs to another product'],
  ])("BLOCKS on %s", (_label, images, remote, message) => {
    expect(buildPlan({ catalog: catalogOf([product("a")]), images, remote, state: emptyState() }).blocking.join(" ")).toContain(message);
  });
});

describe("buildPlan — groups", () => {
  const three = [product("a"), product("b"), product("c")];
  it("creates a group of new products, in the file's storefront order", () => {
    const plan = buildPlan({ catalog: catalogOf(three, [groupStep(["c", "a", "b"])]), images: imagesFor(["a.jpg", "b.jpg", "c.jpg"]), remote: remoteOf(), state: emptyState() });
    expect(plan.groups[0]).toMatchObject({ status: "create" });
    expect(plan.groups[0].members.map((m) => m.productSlug)).toEqual(["c", "a", "b"]);
  });

  it("BLOCKS a group whose member exists but is not this importer's (grouping it would modify an existing product)", () => {
    const remote = remoteOf({ productsBySlug: new Map([["b", { id: "p-b", slug: "b", lifecycle: "published" }]]) });
    const plan = buildPlan({ catalog: catalogOf(three, [groupStep(["a", "b"])]), images: imagesFor(["a.jpg", "b.jpg", "c.jpg"]), remote, state: emptyState() });
    expect(plan.groups[0].status).toBe("blocked");
    expect(plan.blocking.join(" ")).toContain("b exists but was not created by this importer");
  });

  it("BLOCKS a group whose member is already in another group", () => {
    const remote = remoteOf({ productsBySlug: new Map([["a", { id: "p-a", slug: "a", lifecycle: "draft", group: { groupId: "other" } }]]) });
    const state = { ...emptyState(), products: { a: { productId: "p-a", variants: {} } } };
    const plan = buildPlan({ catalog: catalogOf(three, [groupStep(["a", "b"])]), images: imagesFor(["a.jpg", "b.jpg", "c.jpg"]), remote, state });
    expect(plan.blocking.join(" ")).toContain("a is already in another product group");
  });

  it("a group whose create response was lost: adopts the ONE empty group with its name; several are ambiguous and block", () => {
    const catalog = catalogOf(three, [groupStep(["a", "b"])]);
    const key = catalog.groups[0].key;
    const state = { ...emptyState(), groups: { [key]: { pending: { startedAt: "t" } } } };
    const one = buildPlan({ catalog, images: imagesFor(["a.jpg", "b.jpg", "c.jpg"]), remote: remoteOf({ groups: [{ id: "g9", name: { en: "Clips", ar: "كليبس" }, memberCount: 0 }, { id: "g8", name: { en: "Clips", ar: "كليبس" }, memberCount: 2 }] }), state });
    expect(one.groups[0]).toMatchObject({ status: "update", groupId: "g9" });
    const two = buildPlan({ catalog, images: imagesFor(["a.jpg", "b.jpg", "c.jpg"]), remote: remoteOf({ groups: [{ id: "g9", name: { en: "Clips", ar: "كليبس" }, memberCount: 0 }, { id: "g7", name: { en: "Clips", ar: "كليبس" }, memberCount: 0 }] }), state });
    expect(two.blocking.join(" ")).toContain("2 empty groups have this name");
  });

  it("an earlier run's group is updated (members not saved yet) or done (complete) — never created twice", () => {
    const key = catalogOf(three, [groupStep(["a", "b"])]).groups[0].key;
    const update = buildPlan({ catalog: catalogOf(three, [groupStep(["a", "b"])]), images: imagesFor(["a.jpg", "b.jpg", "c.jpg"]), remote: remoteOf({ groupIds: new Set(["g1"]) }), state: { ...emptyState(), groups: { [key]: { groupId: "g1" } } } });
    expect(update.groups[0]).toMatchObject({ status: "update", groupId: "g1" });
    const done = buildPlan({ catalog: catalogOf(three, [groupStep(["a", "b"])]), images: imagesFor(["a.jpg", "b.jpg", "c.jpg"]), remote: remoteOf({ groupIds: new Set(["g1"]) }), state: { ...emptyState(), groups: { [key]: { groupId: "g1", completed: true } } } });
    expect(done.groups[0].status).toBe("done");
  });
});
