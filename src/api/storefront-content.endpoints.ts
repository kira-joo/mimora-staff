import { MethodType, type Endpoint } from "@kira-joo/frontend-toolkit-core";
import type { LocalizedText } from "./brands.endpoints";

/*
 * The storefront's merchandising content: one record, a draft and a published copy.
 * Mirrors `src/server/content/storefront-content.types.ts` as it crosses the wire:
 * ids are strings, dates are ISO strings.
 */

export type LinkKind = "category" | "collection" | "page";

export interface LinkTarget {
  kind: LinkKind;
  id: string;
}

export interface Announcement {
  message: LocalizedText;
  target?: LinkTarget;
  startsAt?: string;
  endsAt?: string;
  enabled: boolean;
}

export interface NavItem {
  target: LinkTarget;
  /** Defaults to the target's own name when absent. */
  label?: LocalizedText;
}

export type HomeSectionType = "campaignHero" | "collectionStory" | "productRail" | "categoryTiles" | "editorialBand" | "assuranceStrip";

export type HomeSection =
  | { type: "campaignHero"; headline: LocalizedText; subline?: LocalizedText; actionLabel?: LocalizedText; target?: LinkTarget }
  | { type: "collectionStory"; collectionId: string; heading?: LocalizedText; body?: LocalizedText }
  | { type: "productRail"; source: "collection" | "newest"; collectionId?: string; heading?: LocalizedText }
  | { type: "categoryTiles"; categoryIds: string[]; heading?: LocalizedText }
  | { type: "editorialBand"; collectionId: string; headline: LocalizedText }
  | { type: "assuranceStrip" };

/** The request body of the draft save, and the shape of `draft`/`published` on read. */
export interface StorefrontContentBody {
  announcements: Announcement[];
  headerNavigation: NavItem[];
  footerNavigation: NavItem[];
  homeSections: HomeSection[];
}

/** Limits the backend enforces (and the design holds to). */
export const STOREFRONT_CONTENT_LIMITS = {
  announcements: 10,
  headerNavigation: 6,
  footerNavigation: 12,
  homeSections: 12,
  categoryTiles: 8,
} as const;

export interface StorefrontContentAdminView {
  draft: StorefrontContentBody;
  draftRevision: number;
  published: StorefrontContentBody | null;
  publishedRevision: number | null;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
}

export interface ResolvedLink {
  kind: LinkKind;
  slug: string;
  label: LocalizedText;
}

/** The part of the storefront's resolved view the console summarises. */
export interface StorefrontContentViewSummary {
  announcement: { message: LocalizedText; link?: ResolvedLink } | null;
  headerNavigation: ResolvedLink[];
  footerNavigation: ResolvedLink[];
  legalLinks: ResolvedLink[];
  homeSections: Array<{ type: HomeSectionType } & Record<string, unknown>>;
}

export interface StorefrontContentProblem {
  /** A form path such as `homeSections.2.collectionId`. */
  field: string;
  messages: string[];
}

export interface StorefrontContentPreview {
  view: StorefrontContentViewSummary;
  /** The revision this preview is of; send it back to publish. */
  draftRevision: number;
  problems: StorefrontContentProblem[];
}

const STOREFRONT_CONTENT = "/admin/storefront-content";

export const getStorefrontContentEndpoint: Endpoint<{ returnType: StorefrontContentAdminView }> = {
  url: STOREFRONT_CONTENT,
  methodType: MethodType.GET,
};

export const saveStorefrontContentDraftEndpoint: Endpoint<{ body: StorefrontContentBody; returnType: StorefrontContentAdminView }> = {
  url: STOREFRONT_CONTENT,
  methodType: MethodType.PUT,
};

export const previewStorefrontContentEndpoint: Endpoint<{ returnType: StorefrontContentPreview }> = {
  url: `${STOREFRONT_CONTENT}/preview`,
  methodType: MethodType.GET,
};

export const publishStorefrontContentEndpoint: Endpoint<{ body: { draftRevision: number }; returnType: StorefrontContentAdminView }> = {
  url: `${STOREFRONT_CONTENT}/publish`,
  methodType: MethodType.PUT,
};
