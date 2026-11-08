import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { PageModel } from "src/server/content/page.schema";
import { PageRevisionModel } from "src/server/content/page-revision.schema";
import { LEGAL_PAGE_SLUGS } from "src/server/content/legal-pages";
import { LEGAL_DRAFT_MARKER } from "src/server/content/page-legal-drafts";
import { createPage } from "src/server/admin/pages/create-page";
import { updatePage } from "src/server/admin/pages/update-page";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * Plan #94 (version history) and #81 (legal drafts), through the real DTO
 * pipeline and auth guard — permissions including the negative case.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const revisionsRoute = (await import("./[id]/revisions/route")).GET as RouteHandler;
const revisionRoute = (await import("./[id]/revisions/[version]/route")).GET as RouteHandler;
const legal = await import("./legal-drafts/route");
const legalStatus = legal.GET as RouteHandler;
const legalCreate = legal.POST as RouteHandler;

const LEGAL = "/api/admin/pages/legal-drafts";
const V1 = { ar: "الشروط الأولى", en: "First terms" };
const V2 = { ar: "الشروط الثانية", en: "Second terms" };
const TITLE = { ar: "شروط البيع", en: "Terms of sale" };

let owner: AdminCaller;
const clean = () => Promise.all([PageModel.deleteMany({}), PageRevisionModel.deleteMany({})]);

beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await clean();
  await removeHarnessStaff();
  await mongoose.disconnect();
});
beforeEach(clean);
afterEach(clean);

const json = async (response: Response) => ({ status: response.status, body: await response.json() });
const history = (caller: AdminCaller, id: string) => caller.call(revisionsRoute, `/api/admin/pages/${id}/revisions`, { params: { id } }).then(json);
const revision = (caller: AdminCaller, id: string, version: string | number) => caller.call(revisionRoute, `/api/admin/pages/${id}/revisions/${version}`, { params: { id, version: String(version) } }).then(json);

describe("GET /api/admin/pages/[id]/revisions — version history", () => {
  it("lists every version newest-first, marks the live one, and carries no body text", async () => {
    const page = await createPage({ slug: "terms", title: TITLE, content: V1, published: true });
    await updatePage(page._id.toString(), { content: V2 });

    const { status, body } = await history(owner, page._id.toString());
    expect(status).toBe(200);
    expect(body.currentVersion).toBe(2);
    expect(body.revisions.map((r: { version: number; isCurrent: boolean }) => [r.version, r.isCurrent])).toEqual([[2, true], [1, false]]);
    expect(body.revisions[0].title).toMatchObject(TITLE);
    expect(JSON.stringify(body)).not.toContain(V1.en); // the list is light; text comes from the single-version fetch
  });

  it("a page never edited has a one-entry history", async () => {
    const page = await createPage({ slug: "terms", title: TITLE, content: V1 });
    const { body } = await history(owner, page._id.toString());
    expect(body.revisions).toHaveLength(1);
    expect(body.revisions[0]).toMatchObject({ version: 1, isCurrent: true });
  });

  it("synthesises the live version for a page that predates versioning (no revision row yet)", async () => {
    const page = await createPage({ slug: "legacy", title: TITLE, content: V1 });
    await PageRevisionModel.deleteMany({});
    const { body } = await history(owner, page._id.toString());
    expect(body.revisions.map((r: { version: number; isCurrent: boolean }) => [r.version, r.isCurrent])).toEqual([[1, true]]);
  });

  it("is 404 for a page that does not exist and 400 for a malformed id", async () => {
    expect((await history(owner, new mongoose.Types.ObjectId().toString())).status).toBe(404);
    expect((await history(owner, "not-an-id")).status).toBe(400);
  });
});

describe("GET /api/admin/pages/[id]/revisions/[version] — one version's text", () => {
  it("returns the text of an OLD version after the page has moved on — 'terms version 1' stays readable", async () => {
    const page = await createPage({ slug: "terms", title: TITLE, content: V1, published: true });
    await updatePage(page._id.toString(), { content: V2 });

    const old = await revision(owner, page._id.toString(), 1);
    expect(old.status).toBe(200);
    expect(old.body).toMatchObject({ version: 1, isCurrent: false, content: V1, title: TITLE });

    const current = await revision(owner, page._id.toString(), 2);
    expect(current.body).toMatchObject({ version: 2, isCurrent: true, content: V2 });
  });

  it("returns the live text of a page that predates versioning", async () => {
    const page = await createPage({ slug: "legacy", title: TITLE, content: V1 });
    await PageRevisionModel.deleteMany({});
    expect((await revision(owner, page._id.toString(), 1)).body).toMatchObject({ version: 1, isCurrent: true, content: V1 });
  });

  it("is 404 for a version that never existed, 400 for a non-positive or non-numeric version", async () => {
    const page = await createPage({ slug: "terms", title: TITLE, content: V1 });
    const id = page._id.toString();
    expect((await revision(owner, id, 9)).status).toBe(404);
    expect((await revision(owner, id, 0)).status).toBe(400);
    expect((await revision(owner, id, "abc")).status).toBe(400);
  });

  it("does not serve one page's revision under another page's id", async () => {
    const a = await createPage({ slug: "a", title: TITLE, content: V1 });
    const b = await createPage({ slug: "b", title: TITLE, content: V2 });
    await updatePage(a._id.toString(), { content: { ar: "ج", en: "A2" } });
    expect((await revision(owner, b._id.toString(), 2)).status).toBe(404);
  });
});

describe("page history permissions — the negative case", () => {
  it("someone with no page permission cannot list or read a version (403)", async () => {
    const page = await createPage({ slug: "terms", title: TITLE, content: V1 });
    const outsider = await signInWithPermissions([AppPermission.PRODUCT.READ]);
    expect((await history(outsider, page._id.toString())).status).toBe(403);
    expect((await revision(outsider, page._id.toString(), 1)).status).toBe(403);
  });

  it("list-only access (Page.read) does not reach the text of a version (403)", async () => {
    const page = await createPage({ slug: "terms", title: TITLE, content: V1 });
    const lister = await signInWithPermissions([AppPermission.PAGE.READ]);
    expect((await history(lister, page._id.toString())).status).toBe(403);
    expect((await revision(lister, page._id.toString(), 1)).status).toBe(403);
  });

  it("a page reader (Page.readOne) can read history", async () => {
    const page = await createPage({ slug: "terms", title: TITLE, content: V1 });
    const reader = await signInWithPermissions([AppPermission.PAGE.READ_ONE]);
    expect((await history(reader, page._id.toString())).status).toBe(200);
    expect((await revision(reader, page._id.toString(), 1)).status).toBe(200);
  });
});

describe("POST /api/admin/pages/legal-drafts — create legal page drafts", () => {
  it("creates all seven legal pages UNPUBLISHED, each opening with the draft marker in both languages", async () => {
    const { status, body } = await owner.call(legalCreate, LEGAL, { method: "POST" }).then(json);
    expect(status).toBe(201);
    expect(body.created).toEqual([...LEGAL_PAGE_SLUGS]);
    expect(body.skipped).toEqual([]);

    const pages = await PageModel.find({}).lean();
    expect(pages.map((page) => page.slug).sort()).toEqual([...LEGAL_PAGE_SLUGS].sort());
    for (const page of pages) {
      expect(page.published).toBe(false);
      expect(page.version).toBe(1);
      expect(page.content.ar.startsWith(LEGAL_DRAFT_MARKER.ar)).toBe(true);
      expect(page.content.en.startsWith(LEGAL_DRAFT_MARKER.en)).toBe(true);
      expect(page.title.ar.length).toBeGreaterThan(0);
      expect(page.title.en.length).toBeGreaterThan(0);
    }
    // every page's first version is kept, like any page created by hand
    expect(await PageRevisionModel.countDocuments({})).toBe(7);
  });

  it("takes the drafted text from legal-and-consent.md where it provides it", async () => {
    await owner.call(legalCreate, LEGAL, { method: "POST" });
    const terms = await PageModel.findOne({ slug: "terms" }).lean();
    expect(terms?.content.en).toContain("By placing an order you agree to them.");
    const privacy = await PageModel.findOne({ slug: "privacy" }).lean();
    expect(privacy?.content.en).toContain("we do not track you across other sites");
  });

  it("is idempotent — a second call creates nothing and changes nothing", async () => {
    await owner.call(legalCreate, LEGAL, { method: "POST" });
    const before = await PageModel.find({}).sort({ slug: 1 }).lean();

    const { body } = await owner.call(legalCreate, LEGAL, { method: "POST" }).then(json);
    expect(body.created).toEqual([]);
    expect(body.skipped).toHaveLength(7);

    const after = await PageModel.find({}).sort({ slug: 1 }).lean();
    expect(after).toEqual(before);
    expect(await PageRevisionModel.countDocuments({})).toBe(7);
  });

  it("never overwrites an existing page — not its text, not its published state, not its version", async () => {
    const mine = { ar: "نصي أنا", en: "My own reviewed terms" };
    const terms = await createPage({ slug: "terms", title: { ar: "شروطي", en: "My terms" }, content: mine, published: true });
    await updatePage(terms._id.toString(), { content: { ar: "نصي المعدل", en: "My edited terms" } }); // version 2
    const cookies = await createPage({ slug: "cookies", title: { ar: "ك", en: "Cookies" }, content: mine, published: false });

    const { body } = await owner.call(legalCreate, LEGAL, { method: "POST" }).then(json);
    expect(body.skipped.sort()).toEqual(["cookies", "terms"]);
    expect(body.created).toHaveLength(5);

    const keptTerms = await PageModel.findById(terms._id).lean();
    expect(keptTerms).toMatchObject({ published: true, version: 2, title: { ar: "شروطي", en: "My terms" }, content: { ar: "نصي المعدل", en: "My edited terms" } });
    const keptCookies = await PageModel.findById(cookies._id).lean();
    expect(keptCookies).toMatchObject({ published: false, content: mine });
    expect(await PageModel.countDocuments({ slug: "terms" })).toBe(1);
  });

  it("never publishes anything, even beside an already-published page", async () => {
    await createPage({ slug: "terms", title: TITLE, content: V1, published: true });
    await owner.call(legalCreate, LEGAL, { method: "POST" });
    const published = await PageModel.find({ published: true }).lean();
    expect(published.map((page) => page.slug)).toEqual(["terms"]);
  });

  it("two simultaneous calls still leave exactly one of each page, none published", async () => {
    const results = await Promise.all([owner.call(legalCreate, LEGAL, { method: "POST" }).then(json), owner.call(legalCreate, LEGAL, { method: "POST" }).then(json)]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    for (const slug of LEGAL_PAGE_SLUGS) expect(await PageModel.countDocuments({ slug })).toBe(1);
    expect(await PageModel.countDocuments({ published: true })).toBe(0);
  });

  it("leaves other, non-legal pages alone", async () => {
    await createPage({ slug: "about", title: { ar: "من نحن", en: "About" }, content: V1, published: true });
    await owner.call(legalCreate, LEGAL, { method: "POST" });
    expect(await PageModel.countDocuments({})).toBe(8);
    expect(await PageModel.countDocuments({ slug: "about", published: true })).toBe(1);
  });
});

describe("GET /api/admin/pages/legal-drafts — status", () => {
  it("reports each legal page as missing, unpublished or published, and whether the terms gate is open", async () => {
    await createPage({ slug: "terms", title: TITLE, content: V1, published: false });
    await createPage({ slug: "privacy", title: TITLE, content: V1, published: true });

    const { body } = await owner.call(legalStatus, LEGAL).then(json);
    const states = Object.fromEntries(body.pages.map((page: { slug: string; state: string }) => [page.slug, page.state]));
    expect(states).toMatchObject({ terms: "unpublished", privacy: "published", returns: "missing", shipping: "missing", cookies: "missing", accessibility: "missing", contact: "missing" });
    expect(body.pages.map((page: { slug: string }) => page.slug)).toEqual([...LEGAL_PAGE_SLUGS]);
    expect(body.termsPublished).toBe(false);
  });

  it("the terms gate is open only when terms itself is published", async () => {
    await createPage({ slug: "terms", title: TITLE, content: V1, published: true });
    expect((await owner.call(legalStatus, LEGAL).then(json)).body.termsPublished).toBe(true);
  });

  it("flags a page whose text still carries the draft marker, and clears the flag once the owner replaces the text", async () => {
    await owner.call(legalCreate, LEGAL, { method: "POST" });
    const flags = async () => Object.fromEntries((await owner.call(legalStatus, LEGAL).then(json)).body.pages.map((page: { slug: string; draftMarkerPresent: boolean }) => [page.slug, page.draftMarkerPresent]));
    expect((await flags()).terms).toBe(true);

    const terms = await PageModel.findOne({ slug: "terms" }).lean();
    await updatePage(terms!._id.toString(), { content: { ar: "الشروط المعتمدة", en: "Approved terms" } });
    expect((await flags()).terms).toBe(false);
  });
});

describe("legal drafts permissions — the negative case", () => {
  it("creating drafts without Page.create is 403 and creates nothing", async () => {
    const reader = await signInWithPermissions([AppPermission.PAGE.READ, AppPermission.PAGE.READ_ONE, AppPermission.PAGE.UPDATE]);
    expect((await reader.call(legalCreate, LEGAL, { method: "POST" })).status).toBe(403);
    expect(await PageModel.countDocuments({})).toBe(0);
  });

  it("someone with no page permission cannot even see the status (403)", async () => {
    const outsider = await signInWithPermissions([AppPermission.PRODUCT.READ]);
    expect((await outsider.call(legalStatus, LEGAL)).status).toBe(403);
  });

  it("a page reader can see the status but not create", async () => {
    const reader = await signInWithPermissions([AppPermission.PAGE.READ]);
    expect((await reader.call(legalStatus, LEGAL)).status).toBe(200);
    expect((await reader.call(legalCreate, LEGAL, { method: "POST" })).status).toBe(403);
  });

  it("a creator (Page.create) can create the drafts", async () => {
    const creator = await signInWithPermissions([AppPermission.PAGE.CREATE]);
    expect((await creator.call(legalCreate, LEGAL, { method: "POST" })).status).toBe(201);
    expect(await PageModel.countDocuments({})).toBe(7);
  });
});
