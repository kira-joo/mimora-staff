import { describe, expect, it } from "vitest";
import type { LegalPageStatus } from "src/api/pages.endpoints";
import { LEGAL_PAGE_LABEL, draftsCreatedMessage, legalPageSignal, summarizeLegalPages } from "./legal-pages";

const page = (state: LegalPageStatus["state"], draftMarkerPresent = false, slug: LegalPageStatus["slug"] = "terms"): LegalPageStatus => ({ slug, state, draftMarkerPresent });

describe("legalPageSignal", () => {
  it("gives every state a word and a tone", () => {
    expect(legalPageSignal(page("missing"))).toEqual({ text: "Missing", tone: "danger" });
    expect(legalPageSignal(page("unpublished"))).toEqual({ text: "Unpublished", tone: "pending" });
    expect(legalPageSignal(page("published"))).toEqual({ text: "Published", tone: "done" });
  });
});

describe("summarizeLegalPages", () => {
  it("counts each state, and flags a published page still carrying the draft marker", () => {
    expect(summarizeLegalPages({ pages: [page("missing"), page("unpublished", true), page("published", true), page("published", false), page("missing")] })).toEqual({
      missing: 2,
      unpublished: 1,
      published: 2,
      publishedWithDraftMarker: 1,
    });
  });
});

describe("draftsCreatedMessage", () => {
  it("says plainly that nothing changed when nothing was created", () => {
    expect(draftsCreatedMessage([], ["terms"])).toMatch(/No page was changed/);
  });

  it("states that drafts are unpublished and mentions what was left alone", () => {
    expect(draftsCreatedMessage(["privacy", "returns"], ["terms"])).toBe("2 drafts created, unpublished. Review each before publishing. 1 existing page was left as it was.");
    expect(draftsCreatedMessage(["privacy"], ["terms", "cookies"])).toMatch(/2 existing pages were left as they were\.$/);
    expect(draftsCreatedMessage(["privacy"], [])).toBe("1 draft created, unpublished. Review each before publishing.");
  });
});

describe("labels", () => {
  it("covers all seven legal pages", () => {
    expect(Object.keys(LEGAL_PAGE_LABEL).sort()).toEqual(["accessibility", "contact", "cookies", "privacy", "returns", "shipping", "terms"]);
  });
});
