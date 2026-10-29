import type { LegalPageSlug, LegalPageStatus, LegalPagesOverview } from "src/api/pages.endpoints";

/** What staff call each legal page — `legal-and-consent.md` §1. The slug stays the address. */
export const LEGAL_PAGE_LABEL: Record<LegalPageSlug, string> = {
  terms: "Terms of Sale",
  privacy: "Privacy Policy",
  returns: "Returns & Refunds",
  shipping: "Delivery & Collection",
  cookies: "Cookies & Storage",
  accessibility: "Accessibility",
  contact: "Contact",
};

export type LegalPageSignal = { text: string; tone: "danger" | "pending" | "done" };

/** One word and one tone per state — never colour alone, the console renders a dot beside the text. */
export function legalPageSignal(page: LegalPageStatus): LegalPageSignal {
  if (page.state === "missing") return { text: "Missing", tone: "danger" };
  if (page.state === "unpublished") return { text: "Unpublished", tone: "pending" };
  return { text: "Published", tone: "done" };
}

export interface LegalSummary {
  missing: number;
  unpublished: number;
  published: number;
  /** Published, but its text still starts with the DRAFT marker — customers would read it. */
  publishedWithDraftMarker: number;
}

export function summarizeLegalPages(overview: Pick<LegalPagesOverview, "pages">): LegalSummary {
  const summary: LegalSummary = { missing: 0, unpublished: 0, published: 0, publishedWithDraftMarker: 0 };
  for (const page of overview.pages) {
    summary[page.state] += 1;
    if (page.state === "published" && page.draftMarkerPresent) summary.publishedWithDraftMarker += 1;
  }
  return summary;
}

/** The sentence that follows a "Create legal page drafts" call. */
export function draftsCreatedMessage(created: readonly string[], skipped: readonly string[]): string {
  if (created.length === 0) return "Nothing to create — every legal page already exists. No page was changed.";
  const noun = created.length === 1 ? "draft" : "drafts";
  const kept = skipped.length === 0 ? "" : skipped.length === 1 ? " 1 existing page was left as it was." : ` ${skipped.length} existing pages were left as they were.`;
  return `${created.length} ${noun} created, unpublished. Review each before publishing.${kept}`;
}
