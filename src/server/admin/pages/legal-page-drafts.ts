import { ConflictError, DuplicateKeyError } from "@kira-joo/backend-toolkit-core";
import { pageRepository } from "../../core/repositories";
import { LEGAL_PAGE_SLUGS, TERMS_PAGE_SLUG } from "../../content/legal-pages";
import { LEGAL_PAGE_DRAFTS, containsDraftMarker } from "../../content/page-legal-drafts";
import { createPage } from "./create-page";

export type LegalPageState = "missing" | "unpublished" | "published";

export interface LegalPageStatus {
  slug: (typeof LEGAL_PAGE_SLUGS)[number];
  state: LegalPageState;
  /** Absent when the page does not exist. */
  pageId?: string;
  version?: number;
  /** The text still carries the "DRAFT — requires owner/legal review" marker. */
  draftMarkerPresent: boolean;
}

export interface LegalPagesOverview {
  pages: LegalPageStatus[];
  /** Checkout refuses every order until the terms page is published — the gate lives in order placement. */
  termsPublished: boolean;
}

export interface CreateLegalDraftsResult extends LegalPagesOverview {
  /** Slugs created by THIS call, always unpublished. */
  created: string[];
  /** Slugs that already existed and were left exactly as they were. */
  skipped: string[];
}

/** Which legal pages are missing, unpublished or published. Read-only. */
export async function getLegalPagesOverview(): Promise<LegalPagesOverview> {
  const existing = await pageRepository.findAll({ where: { slug: { $in: [...LEGAL_PAGE_SLUGS] } }, lean: true });
  const bySlug = new Map(existing.map((page) => [page.slug, page]));

  const pages = LEGAL_PAGE_SLUGS.map((slug): LegalPageStatus => {
    const page = bySlug.get(slug);
    if (!page) return { slug, state: "missing", draftMarkerPresent: false };
    return { slug, state: page.published ? "published" : "unpublished", pageId: page._id.toString(), version: page.version ?? 1, draftMarkerPresent: containsDraftMarker(page.content) };
  });

  return { pages, termsPublished: pages.find((page) => page.slug === TERMS_PAGE_SLUG)?.state === "published" };
}

/**
 * Creates every MISSING legal page as an unpublished, marked draft.
 *
 * Idempotent and non-destructive by construction: a page that exists — in any
 * state, with any text, even one an owner has already rewritten — is skipped
 * untouched, and nothing here ever publishes. Safe to run twice, or from two
 * browsers at once: a slug taken between the check and the write loses to the
 * unique slug and is counted as skipped, not as an error.
 */
export async function createMissingLegalPageDrafts(): Promise<CreateLegalDraftsResult> {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const draft of LEGAL_PAGE_DRAFTS) {
    try {
      // `createPage` itself refuses an existing slug (409) — the same check an owner creating the page by hand meets.
      await createPage({ slug: draft.slug, title: draft.title, content: draft.content, published: false });
      created.push(draft.slug);
    } catch (error) {
      // Taken between the check and the write: the unique slug decided it, and the page that won is not ours to touch.
      if (!(error instanceof ConflictError) && !(error instanceof DuplicateKeyError)) throw error;
      skipped.push(draft.slug);
    }
  }

  return { ...(await getLegalPagesOverview()), created, skipped };
}
