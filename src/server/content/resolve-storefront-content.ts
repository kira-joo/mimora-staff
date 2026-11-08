import type { ImageAsset, LocalizedString } from "@kira-joo/toolkit-common";
import type mongoose from "mongoose";
import { categoryRepository, collectionRepository, pageRepository, storeProfileRepository } from "../core/repositories";
import { LEGAL_PAGE_SLUGS } from "./legal-pages";
import type { Announcement, HomeSection, LinkKind, LinkTarget, NavItem, StorefrontContentBody } from "./storefront-content.types";

export interface ResolvedLink {
  kind: LinkKind;
  slug: string;
  label: LocalizedString;
}

export interface ResolvedEntity {
  slug: string;
  name: LocalizedString;
  description?: LocalizedString;
  image?: ImageAsset;
  /** Collections only, when Staff has set one: the small picture shown where the collection is offered as a choice. */
  icon?: ImageAsset;
}

export type ResolvedHomeSection =
  | { type: "campaignHero"; headline: LocalizedString; subline?: LocalizedString; action?: { label: LocalizedString; link: ResolvedLink }; image: ImageAsset | null }
  | { type: "collectionStory"; collection: ResolvedEntity; heading?: LocalizedString; body?: LocalizedString }
  | { type: "productRail"; source: "collection" | "newest"; collection?: Pick<ResolvedEntity, "slug" | "name">; heading?: LocalizedString }
  | { type: "categoryTiles"; categories: ResolvedEntity[]; heading?: LocalizedString }
  | { type: "editorialBand"; headline: LocalizedString; collection: ResolvedEntity }
  | { type: "assuranceStrip" };

/**
 * The storefront's merchandising content as a customer sees it — `GET
 * /api/storefront/content`, and the same shape the console previews.
 *
 * **Cache tags for a consumer:** this view reads the content record and,
 * through its references, categories, collections, pages and the store
 * profile's hero media — so a cached read must be tagged `CONTENT`,
 * `CATEGORIES`, `COLLECTIONS`, `PAGES` and `STORE_PROFILE`, and its
 * lifetime bounded by `announcementChangesAt`, because a scheduled
 * announcement starting is a change no write announces.
 */
export interface StorefrontContentView {
  /** The one announcement to show now (the first enabled one whose window contains now), or none. */
  announcement: { message: LocalizedString; link?: ResolvedLink } | null;
  /** When the announcement shown would next change, if any is scheduled. */
  announcementChangesAt: Date | null;
  headerNavigation: ResolvedLink[];
  footerNavigation: ResolvedLink[];
  /** Every published legal page — always present, whatever the merchant's footer navigation says. */
  legalLinks: ResolvedLink[];
  homeSections: ResolvedHomeSection[];
  publishedAt: Date | null;
}

type Lookup = Record<LinkKind, Map<string, ResolvedEntity>>;

/**
 * Resolves a content body against what is published *now*. A reference to
 * something missing or unpublished resolves to nothing — the link is
 * dropped, and a section that cannot stand without it is dropped whole —
 * so the storefront degrades to less, never to an empty frame (§13a).
 * Publishing refuses such references up front; this is what keeps the
 * storefront correct when a collection is unpublished afterwards.
 */
export async function resolveStorefrontContent(body: StorefrontContentBody, now: Date, publishedAt: Date | null): Promise<StorefrontContentView> {
  const lookup = await loadReferences(body);
  const linkTo = (target: LinkTarget | undefined, label?: LocalizedString): ResolvedLink | undefined => {
    if (!target) return undefined;
    const entity = lookup[target.kind].get(target.id.toString());
    return entity ? { kind: target.kind, slug: entity.slug, label: present(label) ?? entity.name } : undefined;
  };

  const { announcement, changesAt } = activeAnnouncement(body.announcements, now);
  const legalPages = await pageRepository.findAll({ where: { slug: { $in: [...LEGAL_PAGE_SLUGS] }, published: true }, select: { slug: true, title: true }, lean: true });
  const legalLinks = LEGAL_PAGE_SLUGS.flatMap((slug) => {
    const page = legalPages.find((candidate) => candidate.slug === slug);
    return page ? [{ kind: "page" as const, slug, label: page.title }] : [];
  });

  const needsHeroImage = body.homeSections.some((section) => section.type === "campaignHero");
  const heroImage = needsHeroImage ? ((await storeProfileRepository.findOne({ where: {}, select: { heroMedia: true }, skipThrowError: true, lean: true }))?.heroMedia ?? null) : null;

  const navigation = (items: NavItem[]) => items.flatMap((item) => linkTo(item.target, item.label) ?? []);

  return {
    announcement: announcement ? { message: announcement.message, ...withLink(linkTo(announcement.target)) } : null,
    announcementChangesAt: changesAt,
    headerNavigation: navigation(body.headerNavigation),
    footerNavigation: navigation(body.footerNavigation),
    legalLinks,
    homeSections: body.homeSections.flatMap((section) => resolveSection(section, lookup, linkTo, heroImage) ?? []),
    publishedAt,
  };
}

function resolveSection(section: HomeSection, lookup: Lookup, linkTo: (target: LinkTarget | undefined, label?: LocalizedString) => ResolvedLink | undefined, heroImage: ImageAsset | null): ResolvedHomeSection | undefined {
  const collection = (id: mongoose.Types.ObjectId | undefined) => (id ? lookup.collection.get(id.toString()) : undefined);
  switch (section.type) {
    case "campaignHero": {
      const link = linkTo(section.target);
      return { type: "campaignHero", headline: section.headline, ...optional("subline", section.subline), ...(link && section.actionLabel ? { action: { label: section.actionLabel, link } } : {}), image: heroImage };
    }
    case "collectionStory": {
      const found = collection(section.collectionId);
      return found ? { type: "collectionStory", collection: found, ...optional("heading", section.heading), ...optional("body", section.body) } : undefined;
    }
    case "productRail": {
      if (section.source === "newest") return { type: "productRail", source: "newest", ...optional("heading", section.heading) };
      const found = collection(section.collectionId);
      return found ? { type: "productRail", source: "collection", collection: { slug: found.slug, name: found.name }, ...optional("heading", section.heading) } : undefined;
    }
    case "categoryTiles": {
      const categories = section.categoryIds.flatMap((id) => lookup.category.get(id.toString()) ?? []);
      return categories.length > 0 ? { type: "categoryTiles", categories, ...optional("heading", section.heading) } : undefined;
    }
    case "editorialBand": {
      const found = collection(section.collectionId);
      return found ? { type: "editorialBand", headline: section.headline, collection: found } : undefined;
    }
    case "assuranceStrip":
      return { type: "assuranceStrip" };
  }
}

/** The first enabled announcement whose window contains `now`, and the next instant that answer could change. */
export function activeAnnouncement(announcements: Announcement[], now: Date): { announcement: Announcement | null; changesAt: Date | null } {
  const enabled = announcements.filter((candidate) => candidate.enabled);
  const announcement = enabled.find((candidate) => (!candidate.startsAt || candidate.startsAt <= now) && (!candidate.endsAt || now < candidate.endsAt)) ?? null;
  const boundaries = enabled.flatMap((candidate) => [candidate.startsAt, candidate.endsAt]).filter((instant): instant is Date => !!instant && instant > now);
  const changesAt = boundaries.length > 0 ? new Date(Math.min(...boundaries.map((instant) => instant.getTime()))) : null;
  return { announcement, changesAt };
}

/** Every entity a body references, published ones only, by kind and id. */
async function loadReferences(body: StorefrontContentBody): Promise<Lookup> {
  const ids: Record<LinkKind, Set<string>> = { category: new Set(), collection: new Set(), page: new Set() };
  for (const reference of collectReferences(body)) ids[reference.kind].add(reference.id.toString());

  const [categories, collections, pages] = await Promise.all([
    ids.category.size ? categoryRepository.findAll({ where: { _id: { $in: [...ids.category] }, published: true }, select: { slug: true, name: true, description: true, image: true }, lean: true }) : [],
    ids.collection.size ? collectionRepository.findAll({ where: { _id: { $in: [...ids.collection] }, published: true }, select: { slug: true, name: true, description: true, image: true, icon: true }, lean: true }) : [],
    ids.page.size ? pageRepository.findAll({ where: { _id: { $in: [...ids.page] }, published: true }, select: { slug: true, title: true }, lean: true }) : [],
  ]);

  const entity = (doc: { slug: string; name: LocalizedString; description?: LocalizedString; image?: ImageAsset; icon?: ImageAsset }): ResolvedEntity => ({ slug: doc.slug, name: doc.name, ...optional("description", doc.description), ...(doc.image ? { image: doc.image } : {}), ...(doc.icon ? { icon: doc.icon } : {}) });
  return {
    category: new Map(categories.map((doc) => [doc._id.toString(), entity(doc)])),
    collection: new Map(collections.map((doc) => [doc._id.toString(), entity(doc)])),
    page: new Map(pages.map((doc) => [doc._id.toString(), { slug: doc.slug, name: doc.title }])),
  };
}

/** Every reference in a body, with the form field path it came from — shared with publish validation. */
export function collectReferences(body: StorefrontContentBody): Array<{ kind: LinkKind; id: mongoose.Types.ObjectId; field: string }> {
  const references: Array<{ kind: LinkKind; id: mongoose.Types.ObjectId; field: string }> = [];
  const target = (value: LinkTarget | undefined, field: string) => value && references.push({ kind: value.kind, id: value.id, field });

  body.announcements.forEach((item, index) => target(item.target, `announcements.${index}.target`));
  body.headerNavigation.forEach((item, index) => target(item.target, `headerNavigation.${index}.target`));
  body.footerNavigation.forEach((item, index) => target(item.target, `footerNavigation.${index}.target`));
  body.homeSections.forEach((section, index) => {
    if (section.type === "campaignHero") target(section.target, `homeSections.${index}.target`);
    if ((section.type === "collectionStory" || section.type === "editorialBand" || section.type === "productRail") && section.collectionId) {
      references.push({ kind: "collection", id: section.collectionId, field: `homeSections.${index}.collectionId` });
    }
    if (section.type === "categoryTiles") section.categoryIds.forEach((id, tile) => references.push({ kind: "category", id, field: `homeSections.${index}.categoryIds.${tile}` }));
  });
  return references;
}

/** A localized value with something in it, or undefined — an optional field left blank in both locales is absent. */
function present(value: LocalizedString | undefined): LocalizedString | undefined {
  return value && (value.ar.trim() !== "" || value.en.trim() !== "") ? { ar: value.ar, en: value.en } : undefined;
}

function optional<K extends string>(key: K, value: LocalizedString | undefined): Partial<Record<K, LocalizedString>> {
  const kept = present(value);
  return kept ? ({ [key]: kept } as Record<K, LocalizedString>) : {};
}

function withLink(link: ResolvedLink | undefined): { link?: ResolvedLink } {
  return link ? { link } : {};
}
