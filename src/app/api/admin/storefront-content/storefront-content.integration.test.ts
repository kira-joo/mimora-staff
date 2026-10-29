import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { StorefrontContentModel } from "src/server/content/storefront-content.schema";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * Route-level: typed section validation through the real DTO pipeline,
 * permissions including the negative cases, and cache invalidation —
 * fired once by a publish that succeeds, never by a draft save or a
 * refused publish.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const content = await import("./route");
const publishRoute = (await import("./publish/route")).PUT as RouteHandler;
const previewRoute = (await import("./preview/route")).GET as RouteHandler;
const saveRoute = content.PUT as RouteHandler;
const readRoute = content.GET as RouteHandler;

const PATH = "/api/admin/storefront-content";
const empty = { announcements: [], headerNavigation: [], footerNavigation: [], homeSections: [] };
const revalidations: Array<{ tags: string[] }> = [];
const realFetch = globalThis.fetch;

let owner: AdminCaller;

async function save(caller: AdminCaller, body: unknown) {
  const response = await caller.call(saveRoute, PATH, { method: "PUT", body });
  return { status: response.status, body: await response.json() };
}

async function publish(caller: AdminCaller, draftRevision: number) {
  return caller.call(publishRoute, `${PATH}/publish`, { method: "PUT", body: { draftRevision } });
}

beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});

afterAll(async () => {
  await Promise.all([removeHarnessStaff(), StorefrontContentModel.deleteMany({})]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  await StorefrontContentModel.deleteMany({});
  revalidations.length = 0;
  process.env.STOREFRONT_REVALIDATE_URL = "http://storefront.test/api/revalidate";
  process.env.REVALIDATE_SECRET = "test-revalidate-secret";
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("http://storefront.test/")) {
      revalidations.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200 });
    }
    return realFetch(url, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STOREFRONT_REVALIDATE_URL;
  delete process.env.REVALIDATE_SECRET;
});

describe("typed section validation", () => {
  it("accepts a valid draft and bumps the revision", async () => {
    const { status, body } = await save(owner, { ...empty, homeSections: [{ type: "productRail", source: "newest" }] });
    expect(status).toBe(200);
    expect(body.draftRevision).toBe(1);
  });

  it.each([
    ["an unknown section type", { type: "carousel" }],
    ["a field belonging to another section type", { type: "assuranceStrip", headline: { ar: "ع", en: "H" } }],
    ["a malformed collection id", { type: "collectionStory", collectionId: "not-an-id" }],
    ["category tiles with no categories", { type: "categoryTiles", categoryIds: [] }],
    ["an editorial band without its headline", { type: "editorialBand", collectionId: new mongoose.Types.ObjectId().toString() }],
    ["a campaign hero without its headline", { type: "campaignHero" }],
  ])("refuses %s with a 400", async (_, section) => {
    const { status, body } = await save(owner, { ...empty, homeSections: [section] });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain("homeSections.0");
    expect(await StorefrontContentModel.countDocuments({})).toBe(0);
  });

  it("refuses a navigation item with no destination", async () => {
    const { status, body } = await save(owner, { ...empty, footerNavigation: [{ label: { ar: "ع", en: "A" } }] });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain("footerNavigation.0.target");
  });

  it("refuses more header links than the design holds", async () => {
    const link = { target: { kind: "category", id: new mongoose.Types.ObjectId().toString() } };
    expect((await save(owner, { ...empty, headerNavigation: Array.from({ length: 7 }, () => link) })).status).toBe(400);
  });
});

describe("permissions", () => {
  it("an editor can save a draft but cannot publish it (403)", async () => {
    const editor = await signInWithPermissions([AppPermission.STOREFRONT_CONTENT.READ, AppPermission.STOREFRONT_CONTENT.UPDATE]);
    const { status, body } = await save(editor, { ...empty, homeSections: [{ type: "assuranceStrip" }] });
    expect(status).toBe(200);

    expect((await publish(editor, body.draftRevision)).status).toBe(403);
    expect((await StorefrontContentModel.findOne({}).lean())?.published).toBeUndefined();
    expect(revalidations).toEqual([]);
  });

  it("a reader can read and preview but cannot save (403)", async () => {
    const reader = await signInWithPermissions([AppPermission.STOREFRONT_CONTENT.READ]);
    expect((await reader.call(readRoute, PATH)).status).toBe(200);
    expect((await reader.call(previewRoute, `${PATH}/preview`)).status).toBe(200);
    expect((await save(reader, empty)).status).toBe(403);
  });

  it("someone with no storefront-content permission cannot even read it (403)", async () => {
    const outsider = await signInWithPermissions([AppPermission.PRODUCT.READ]);
    expect((await outsider.call(readRoute, PATH)).status).toBe(403);
  });

  it("a publisher with only the publish permission can publish", async () => {
    const { body } = await save(owner, { ...empty, homeSections: [{ type: "assuranceStrip" }] });
    const publisher = await signInWithPermissions([CustomPermission.STOREFRONT_CONTENT_PUBLISH]);
    expect((await publish(publisher, body.draftRevision)).status).toBe(200);
  });
});

describe("cache invalidation", () => {
  it("a draft save invalidates nothing — customers cannot see a draft", async () => {
    await save(owner, { ...empty, homeSections: [{ type: "assuranceStrip" }] });
    expect(revalidations).toEqual([]);
  });

  it("a successful publish invalidates CONTENT exactly once", async () => {
    const { body } = await save(owner, { ...empty, homeSections: [{ type: "assuranceStrip" }] });
    expect((await publish(owner, body.draftRevision)).status).toBe(200);
    await vi.waitFor(() => expect(revalidations).toHaveLength(1));
    expect(revalidations[0]?.tags).toEqual(["CONTENT"]);
  });

  it("a refused publish — a stale revision — invalidates nothing", async () => {
    const { body } = await save(owner, { ...empty, homeSections: [{ type: "assuranceStrip" }] });
    await save(owner, empty);

    const response = await publish(owner, body.draftRevision);
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).toContain("DRAFT_CHANGED");
    expect(revalidations).toEqual([]);
  });
});
