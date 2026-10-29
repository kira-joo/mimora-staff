import type { LocalizedString } from "@kira-joo/toolkit-common";
import type mongoose from "mongoose";

/**
 * The storefront's merchandising content — plan #78 (home sections), #79
 * (navigation) and #80 (announcement bar), owner decision "Option A",
 * 2026-10-12: one record, draft then publish.
 *
 * The section vocabulary is `store-platform/docs/design-system.md` §13a
 * (owner decision D-S3). The merchant chooses and orders sections; the
 * storefront owns how each one looks — so a section carries only content
 * and references, never colours, sizes or layout.
 */

/** What a navigation item, an announcement or a hero action may point at (#79: "which categories/collections appear"; pages for the footer). */
export const LINK_KINDS = ["category", "collection", "page"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export interface LinkTarget {
  kind: LinkKind;
  id: mongoose.Types.ObjectId;
}

export interface Announcement {
  message: LocalizedString;
  target?: LinkTarget;
  /** #80 "schedulable": shown from `startsAt` (inclusive) until `endsAt` (exclusive). Either may be absent. */
  startsAt?: Date;
  endsAt?: Date;
  enabled: boolean;
}

export interface NavItem {
  target: LinkTarget;
  /** Defaults to the target's own name when blank in both locales. */
  label?: LocalizedString;
}

export const HOME_SECTION_TYPES = ["campaignHero", "collectionStory", "productRail", "categoryTiles", "editorialBand", "assuranceStrip"] as const;
export type HomeSectionType = (typeof HOME_SECTION_TYPES)[number];

/** Image: the store profile's `heroMedia` (MDS §6.1 "hero from the store profile"). */
export interface CampaignHeroSection {
  type: "campaignHero";
  headline: LocalizedString;
  subline?: LocalizedString;
  /** The one action — label and target together, or neither. */
  actionLabel?: LocalizedString;
  target?: LinkTarget;
}

export interface CollectionStorySection {
  type: "collectionStory";
  collectionId: mongoose.Types.ObjectId;
  heading?: LocalizedString;
  body?: LocalizedString;
}

export interface ProductRailSection {
  type: "productRail";
  source: "collection" | "newest";
  /** Present exactly when `source` is `"collection"`. */
  collectionId?: mongoose.Types.ObjectId;
  heading?: LocalizedString;
}

export interface CategoryTilesSection {
  type: "categoryTiles";
  categoryIds: mongoose.Types.ObjectId[];
  heading?: LocalizedString;
}

/** Image and link: the collection's own. */
export interface EditorialBandSection {
  type: "editorialBand";
  collectionId: mongoose.Types.ObjectId;
  headline: LocalizedString;
}

/** Content comes from fulfilment, payment and returns settings — never typed copy. */
export interface AssuranceStripSection {
  type: "assuranceStrip";
}

export type HomeSection = CampaignHeroSection | CollectionStorySection | ProductRailSection | CategoryTilesSection | EditorialBandSection | AssuranceStripSection;

export interface StorefrontContentBody {
  /** Ordered; the storefront shows one at a time — the first enabled one in its window. */
  announcements: Announcement[];
  headerNavigation: NavItem[];
  /** Merchant-chosen footer links. The legal pages are always listed separately and cannot be removed. */
  footerNavigation: NavItem[];
  homeSections: HomeSection[];
}

export const EMPTY_STOREFRONT_CONTENT: StorefrontContentBody = { announcements: [], headerNavigation: [], footerNavigation: [], homeSections: [] };

/** Limits the design holds to (§13a, §13b). */
export const STOREFRONT_CONTENT_LIMITS = {
  announcements: 10,
  headerNavigation: 6,
  footerNavigation: 12,
  homeSections: 12,
  categoryTiles: 8,
} as const;
