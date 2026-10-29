import { describe, expect, it } from "vitest";
import type { StorefrontContentBody } from "src/api/storefront-content.endpoints";
import {
  decodeTarget,
  describeProblemField,
  encodeTarget,
  mapStorefrontContentToFormValues,
  newAnnouncement,
  newNavItem,
  newSection,
  toSaveBody,
} from "./storefront-content-values";

const A = "64b0c0c0c0c0c0c0c0c0c0a1";
const B = "64b0c0c0c0c0c0c0c0c0c0b2";
const C = "64b0c0c0c0c0c0c0c0c0c0c3";

const FULL: StorefrontContentBody = {
  announcements: [{ message: { ar: "شحن مجاني", en: "Free shipping" }, target: { kind: "page", id: A }, startsAt: "2026-10-12T08:00:00.000Z", endsAt: "2026-10-20T08:00:00.000Z", enabled: false }],
  headerNavigation: [{ target: { kind: "category", id: B }, label: { ar: "", en: "Shop" } }],
  footerNavigation: [{ target: { kind: "page", id: A } }],
  homeSections: [
    { type: "campaignHero", headline: { ar: "مرحبا", en: "Hello" }, subline: { ar: "", en: "Sub" }, actionLabel: { ar: "تسوق", en: "Shop" }, target: { kind: "collection", id: C } },
    { type: "collectionStory", collectionId: C, heading: { ar: "", en: "Story" }, body: { ar: "", en: "Body" } },
    { type: "productRail", source: "collection", collectionId: C, heading: { ar: "", en: "Rail" } },
    { type: "productRail", source: "newest" },
    { type: "categoryTiles", categoryIds: [A, B], heading: { ar: "", en: "Tiles" } },
    { type: "editorialBand", collectionId: C, headline: { ar: "", en: "Band" } },
    { type: "assuranceStrip" },
  ],
};

describe("create defaults", () => {
  it("is an empty draft with no oldData", () => {
    expect(mapStorefrontContentToFormValues()).toEqual({ announcements: [], headerNavigation: [], footerNavigation: [], homeSections: [] });
  });

  it("new rows start blank, and a rail starts on the newest source", () => {
    expect(newAnnouncement()).toEqual({ message: { ar: "", en: "" }, target: "", startsAt: "", endsAt: "", enabled: true });
    expect(newNavItem()).toEqual({ target: "", label: { ar: "", en: "" } });
    expect(newSection("productRail")).toMatchObject({ type: "productRail", source: "newest", collectionId: "" });
    expect(newSection("assuranceStrip")).toEqual({ type: "assuranceStrip" });
  });

  it("new rows do not share their localized objects", () => {
    const a = newAnnouncement();
    const b = newAnnouncement();
    a.message.en = "x";
    expect(b.message.en).toBe("");
  });
});

describe("link targets", () => {
  it("round-trips kind and id", () => {
    expect(decodeTarget(encodeTarget({ kind: "collection", id: A }))).toEqual({ kind: "collection", id: A });
  });
  it("blank, the none sentinel and unknown kinds decode to nothing", () => {
    expect(decodeTarget("")).toBeUndefined();
    expect(decodeTarget("__none__")).toBeUndefined();
    expect(decodeTarget("product:abc")).toBeUndefined();
    expect(decodeTarget("page:")).toBeUndefined();
    expect(encodeTarget(undefined)).toBe("");
  });
});

describe("edit mapping", () => {
  const values = mapStorefrontContentToFormValues({ draft: FULL });

  it("maps an announcement, keeping the instants as given", () => {
    expect(values.announcements[0]).toEqual({ message: { ar: "شحن مجاني", en: "Free shipping" }, target: `page:${A}`, startsAt: "2026-10-12T08:00:00.000Z", endsAt: "2026-10-20T08:00:00.000Z", enabled: false });
  });

  it("maps navigation; an absent label becomes blank text", () => {
    expect(values.headerNavigation[0]).toEqual({ target: `category:${B}`, label: { ar: "", en: "Shop" } });
    expect(values.footerNavigation[0]).toEqual({ target: `page:${A}`, label: { ar: "", en: "" } });
  });

  it("maps every section type", () => {
    expect(values.homeSections.map((s) => s.type)).toEqual(["campaignHero", "collectionStory", "productRail", "productRail", "categoryTiles", "editorialBand", "assuranceStrip"]);
    expect(values.homeSections[0]).toMatchObject({ target: `collection:${C}`, actionLabel: { ar: "تسوق", en: "Shop" } });
    expect(values.homeSections[2]).toMatchObject({ source: "collection", collectionId: C });
    expect(values.homeSections[3]).toMatchObject({ source: "newest", collectionId: "", heading: { ar: "", en: "" } });
    expect(values.homeSections[4]).toMatchObject({ categoryIds: [A, B] });
  });
});

describe("toSaveBody", () => {
  it("round-trips a full draft unchanged", () => {
    expect(toSaveBody(mapStorefrontContentToFormValues({ draft: FULL }))).toEqual(FULL);
  });

  it("sends each section only its own type's fields", () => {
    const body = toSaveBody(mapStorefrontContentToFormValues({ draft: FULL }));
    const keys = body.homeSections.map((s) => Object.keys(s).sort());
    expect(keys[0]).toEqual(["actionLabel", "headline", "subline", "target", "type"]);
    expect(keys[1]).toEqual(["body", "collectionId", "heading", "type"]);
    expect(keys[2]).toEqual(["collectionId", "heading", "source", "type"]);
    expect(keys[3]).toEqual(["source", "type"]);
    expect(keys[4]).toEqual(["categoryIds", "heading", "type"]);
    expect(keys[5]).toEqual(["collectionId", "headline", "type"]);
    expect(keys[6]).toEqual(["type"]);
  });

  it("omits blank optional text, an empty link and empty dates", () => {
    const body = toSaveBody({
      announcements: [{ ...newAnnouncement(), message: { ar: "", en: "Hi" } }],
      headerNavigation: [{ target: `page:${A}`, label: { ar: "  ", en: "" } }],
      footerNavigation: [],
      homeSections: [{ ...(newSection("campaignHero") as Extract<ReturnType<typeof newSection>, { type: "campaignHero" }>), headline: { ar: "", en: "Hello" } }],
    });
    expect(body.announcements[0]).toEqual({ message: { ar: "", en: "Hi" }, enabled: true });
    expect(body.headerNavigation[0]).toEqual({ target: { kind: "page", id: A } });
    expect(body.homeSections[0]).toEqual({ type: "campaignHero", headline: { ar: "", en: "Hello" } });
  });

  it("keeps a required headline even when blank, so the server names it", () => {
    const body = toSaveBody({ announcements: [], headerNavigation: [], footerNavigation: [], homeSections: [newSection("editorialBand")] });
    expect(body.homeSections[0]).toMatchObject({ type: "editorialBand", headline: { ar: "", en: "" } });
  });

  it("drops a rail's collection when the source is newest, even if one is still in the form", () => {
    const body = toSaveBody({ announcements: [], headerNavigation: [], footerNavigation: [], homeSections: [{ type: "productRail", source: "newest", collectionId: C, heading: { ar: "", en: "" } }] });
    expect(body.homeSections[0]).toEqual({ type: "productRail", source: "newest" });
  });

  it("normalises dates to ISO instants", () => {
    const body = toSaveBody({ announcements: [{ ...newAnnouncement(), startsAt: "2026-10-12T10:30", endsAt: "2026-10-13T10:30:00.000Z" }], headerNavigation: [], footerNavigation: [], homeSections: [] });
    expect(body.announcements[0]?.startsAt).toBe(new Date("2026-10-12T10:30").toISOString());
    expect(body.announcements[0]?.startsAt).toMatch(/Z$/);
    expect(body.announcements[0]?.endsAt).toBe("2026-10-13T10:30:00.000Z");
  });

  it("trims text", () => {
    const body = toSaveBody({ announcements: [{ ...newAnnouncement(), message: { ar: " أ ", en: " a " } }], headerNavigation: [], footerNavigation: [], homeSections: [] });
    expect(body.announcements[0]?.message).toEqual({ ar: "أ", en: "a" });
  });
});

describe("describeProblemField", () => {
  const sections = [{ type: "campaignHero" as const }, { type: "productRail" as const }, { type: "categoryTiles" as const }];

  it("names the section and its type", () => {
    expect(describeProblemField("homeSections.1.collectionId", sections)).toBe("Section 2 (Product rail) · Collection");
    expect(describeProblemField("homeSections.0.type", sections)).toBe("Section 1 (Campaign hero) · Section type");
    expect(describeProblemField("homeSections.2.categoryIds.0", sections)).toBe("Section 3 (Category tiles) · Categories item 1");
  });

  it("qualifies a locale instead of dropping it", () => {
    expect(describeProblemField("homeSections.0.headline.ar", sections)).toBe("Section 1 (Campaign hero) · Headline (Arabic)");
    expect(describeProblemField("announcements.0.message.en", [])).toBe("Announcement 1 · Message (English)");
  });

  it("covers lists and a target's inner id", () => {
    expect(describeProblemField("headerNavigation.3.target.id")).toBe("Header link 4 · Link");
    expect(describeProblemField("footerNavigation.0.label.ar")).toBe("Footer link 1 · Link text (Arabic)");
    expect(describeProblemField("announcements.2.endsAt")).toBe("Announcement 3 · End");
  });

  it("falls back to the raw path for anything unknown", () => {
    expect(describeProblemField("somethingElse")).toBe("somethingElse");
  });
});
