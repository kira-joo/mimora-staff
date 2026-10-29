import type { LocalizedString } from "@kira-joo/toolkit-common";
import { pageRepository, pageRevisionRepository } from "../../core/repositories";
import { revisionKey } from "./page-revisions";

/** A version in the history list — no body, so a long history stays light. The text of one is fetched by `getPageRevision`. */
export interface PageRevisionSummary {
  version: number;
  slug: string;
  title: LocalizedString;
  createdAt: Date;
  /** The version currently live on the page. */
  isCurrent: boolean;
}

export interface PageRevisionHistory {
  pageId: string;
  currentVersion: number;
  /** Newest first. */
  revisions: PageRevisionSummary[];
}

export interface PageRevisionDetail extends PageRevisionSummary {
  content: LocalizedString;
}

/** `timestamps: true` adds these at runtime; the schema classes do not declare them. */
const stamps = (document: object) => document as { createdAt: Date; updatedAt: Date };

/** Hard ceiling; a page does not accrue this many edits, and an unbounded list would be a foot-gun, not a feature. */
const MAX_REVISIONS = 500;

/**
 * Every version of a page, newest first (D-13). An order records only the
 * version number of the terms it accepted, so staff must be able to find
 * version N here and read it back.
 *
 * A page written before versioning has no row for its live text until its next
 * edit; the live version is synthesised into the list so "current" is never
 * missing from its own history.
 */
export async function listPageRevisions(pageId: string): Promise<PageRevisionHistory> {
  const page = await pageRepository.findOne({ where: { _id: pageId }, lean: true });
  const currentVersion = page.version ?? 1;
  const rows = await pageRevisionRepository.findAll({ where: { pageId: page._id }, lean: true });

  const revisions: PageRevisionSummary[] = rows
    .sort((a, b) => b.version - a.version)
    .slice(0, MAX_REVISIONS)
    .map((row) => ({ version: row.version, slug: row.slug, title: row.title, createdAt: stamps(row).createdAt, isCurrent: row.version === currentVersion }));

  if (!revisions.some((revision) => revision.version === currentVersion)) {
    revisions.unshift({ version: currentVersion, slug: page.slug, title: page.title, createdAt: stamps(page).updatedAt, isCurrent: true });
  }
  return { pageId: page._id.toString(), currentVersion, revisions };
}

/**
 * The full text of one version. For the live version of a page that predates
 * versioning, the page itself is the source of truth and is returned.
 */
export async function getPageRevision(pageId: string, version: number): Promise<PageRevisionDetail> {
  const page = await pageRepository.findOne({ where: { _id: pageId }, lean: true });
  const currentVersion = page.version ?? 1;

  const row = await pageRevisionRepository.findOne({ where: { revisionKey: revisionKey(page._id, version) }, skipThrowError: true, lean: true });
  if (row) return { version: row.version, slug: row.slug, title: row.title, content: row.content, createdAt: stamps(row).createdAt, isCurrent: row.version === currentVersion };

  if (version === currentVersion) return { version, slug: page.slug, title: page.title, content: page.content, createdAt: stamps(page).updatedAt, isCurrent: true };

  // A version that never existed is a 404 from the repository's own not-found.
  const missing = await pageRevisionRepository.findOne({ where: { revisionKey: revisionKey(page._id, version) } });
  return { version: missing.version, slug: missing.slug, title: missing.title, content: missing.content, createdAt: stamps(missing).createdAt, isCurrent: false };
}
