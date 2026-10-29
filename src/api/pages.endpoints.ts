import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";
import type { LocalizedText } from "./brands.endpoints";

export interface ContentPage {
  _id: string;
  slug: string;
  title: LocalizedText;
  content: LocalizedText;
  published: boolean;
  /** D-13: the version of the title and text currently live; moves only when either changes. An order records the version of the terms it accepted. */
  version: number;
  /** `ogImage` exists on the record but no admin route takes an upload, so it is neither shown nor sent. */
  seo: { title?: LocalizedText; description?: LocalizedText };
  createdAt?: string;
  updatedAt?: string;
}

export interface ContentPageInput {
  slug: string;
  title: LocalizedText;
  content: LocalizedText;
  published: boolean;
  seo: { title: LocalizedText; description: LocalizedText };
}

export interface ListPagesQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  published?: boolean;
  [key: string]: unknown;
}

const PAGES = "/admin/pages";

export const listPagesEndpoint: Endpoint<{ query: ListPagesQuery; returnType: PaginatedResponse<ContentPage> }> = {
  url: PAGES,
  methodType: MethodType.GET,
};

export const getPageEndpoint: Endpoint<{ params: { id: string }; returnType: ContentPage }> = {
  url: `${PAGES}/:id`,
  methodType: MethodType.GET,
};

export const createPageEndpoint: Endpoint<{ body: ContentPageInput; returnType: ContentPage }> = {
  url: PAGES,
  methodType: MethodType.POST,
};

export const updatePageEndpoint: Endpoint<{ params: { id: string }; body: Partial<ContentPageInput>; returnType: ContentPage }> = {
  url: `${PAGES}/:id`,
  methodType: MethodType.PUT,
};

/** The API's DELETE unpublishes; the page record stays. */
export const unpublishPageEndpoint: Endpoint<{ params: { id: string }; returnType: void }> = {
  url: `${PAGES}/:id`,
  methodType: MethodType.DELETE,
};

/** One version in a page's history — no body; the text of one is fetched by `getPageRevisionEndpoint`. */
export interface PageRevisionSummary {
  version: number;
  slug: string;
  title: LocalizedText;
  createdAt: string;
  isCurrent: boolean;
}

export interface PageRevisionHistory {
  pageId: string;
  currentVersion: number;
  /** Newest first. */
  revisions: PageRevisionSummary[];
}

export interface PageRevisionDetail extends PageRevisionSummary {
  content: LocalizedText;
}

export const listPageRevisionsEndpoint: Endpoint<{ params: { id: string }; returnType: PageRevisionHistory }> = {
  url: `${PAGES}/:id/revisions`,
  methodType: MethodType.GET,
};

export const getPageRevisionEndpoint: Endpoint<{ params: { id: string; version: number }; returnType: PageRevisionDetail }> = {
  url: `${PAGES}/:id/revisions/:version`,
  methodType: MethodType.GET,
};

export type LegalPageSlug = "terms" | "privacy" | "returns" | "shipping" | "cookies" | "accessibility" | "contact";

export interface LegalPageStatus {
  slug: LegalPageSlug;
  state: "missing" | "unpublished" | "published";
  /** Absent when the page does not exist. */
  pageId?: string;
  version?: number;
  /** The text still carries the "DRAFT — requires owner/legal review" marker. */
  draftMarkerPresent: boolean;
}

export interface LegalPagesOverview {
  pages: LegalPageStatus[];
  /** Orders are refused until the terms page is published. */
  termsPublished: boolean;
}

export interface CreateLegalDraftsResult extends LegalPagesOverview {
  created: string[];
  skipped: string[];
}

export const legalPagesEndpoint: Endpoint<{ returnType: LegalPagesOverview }> = {
  url: `${PAGES}/legal-drafts`,
  methodType: MethodType.GET,
};

/** Adds every MISSING legal page as an unpublished, marked draft. Never overwrites, never publishes. */
export const createLegalDraftsEndpoint: Endpoint<{ returnType: CreateLegalDraftsResult }> = {
  url: `${PAGES}/legal-drafts`,
  methodType: MethodType.POST,
};
