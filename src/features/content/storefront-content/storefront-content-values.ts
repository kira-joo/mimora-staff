import type { LocalizedText } from "src/api/brands.endpoints";
import {
  type Announcement,
  type HomeSection,
  type HomeSectionType,
  type LinkKind,
  type LinkTarget,
  type NavItem,
  type StorefrontContentAdminView,
  type StorefrontContentBody,
} from "src/api/storefront-content.endpoints";

/*
 * Form values <-> wire bodies for the storefront-content draft.
 * The form holds what its inputs hold: a link target is one string (`kind:id`, "" for none), a date is the
 * ISO string the date-time picker produces ("" for none). `toSaveBody` converts once, at submit, and sends each
 * home section ONLY its own type's fields (the API refuses any other).
 */

const EMPTY_TEXT: LocalizedText = { ar: "", en: "" };

// --- Form values ------------------------------------------------------------------------------------------------

export interface AnnouncementValue {
  message: LocalizedText;
  target: string;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
}

export interface NavItemValue {
  target: string;
  label: LocalizedText;
}

export type SectionValue =
  | { type: "campaignHero"; headline: LocalizedText; subline: LocalizedText; actionLabel: LocalizedText; target: string }
  | { type: "collectionStory"; collectionId: string; heading: LocalizedText; body: LocalizedText }
  | { type: "productRail"; source: "collection" | "newest"; collectionId: string; heading: LocalizedText }
  | { type: "categoryTiles"; categoryIds: string[]; heading: LocalizedText }
  | { type: "editorialBand"; collectionId: string; headline: LocalizedText }
  | { type: "assuranceStrip" };

export interface StorefrontContentFormValues {
  announcements: AnnouncementValue[];
  headerNavigation: NavItemValue[];
  footerNavigation: NavItemValue[];
  homeSections: SectionValue[];
}

// --- Link targets -----------------------------------------------------------------------------------------------

const LINK_KINDS: readonly LinkKind[] = ["category", "collection", "page"];

export const encodeTarget = (target: LinkTarget | undefined): string => (target ? `${target.kind}:${target.id}` : "");

/** `"collection:abc"` -> `{kind, id}`; anything else (including "" and the picker's "no link" sentinel) -> undefined. */
export function decodeTarget(value: string | undefined): LinkTarget | undefined {
  const [kind, ...rest] = (value ?? "").split(":");
  const id = rest.join(":");
  return id && (LINK_KINDS as readonly string[]).includes(kind ?? "") ? { kind: kind as LinkKind, id } : undefined;
}

// --- Cleaning helpers -------------------------------------------------------------------------------------------

const text = (value: LocalizedText | undefined): LocalizedText => ({ ar: value?.ar ?? "", en: value?.en ?? "" });
const isBlank = (value: LocalizedText): boolean => !value.ar.trim() && !value.en.trim();
const clean = (value: LocalizedText): LocalizedText => ({ ar: value.ar.trim(), en: value.en.trim() });
/** A blank-in-both optional text is left out of the body (the backend reads absent as "none"); a required one is always sent. */
const optionalText = (value: LocalizedText): LocalizedText | undefined => (isBlank(value) ? undefined : clean(value));

function isoOrUndefined(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Only the keys that hold something, so an absent optional field is omitted rather than sent as `undefined`/blank. */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

// --- Defaults for new rows --------------------------------------------------------------------------------------

export const newAnnouncement = (): AnnouncementValue => ({ message: { ...EMPTY_TEXT }, target: "", startsAt: "", endsAt: "", enabled: true });
export const newNavItem = (): NavItemValue => ({ target: "", label: { ...EMPTY_TEXT } });

export function newSection(type: HomeSectionType): SectionValue {
  switch (type) {
    case "campaignHero":
      return { type, headline: { ...EMPTY_TEXT }, subline: { ...EMPTY_TEXT }, actionLabel: { ...EMPTY_TEXT }, target: "" };
    case "collectionStory":
      return { type, collectionId: "", heading: { ...EMPTY_TEXT }, body: { ...EMPTY_TEXT } };
    case "productRail":
      return { type, source: "newest", collectionId: "", heading: { ...EMPTY_TEXT } };
    case "categoryTiles":
      return { type, categoryIds: [], heading: { ...EMPTY_TEXT } };
    case "editorialBand":
      return { type, collectionId: "", headline: { ...EMPTY_TEXT } };
    case "assuranceStrip":
      return { type };
  }
}

// --- API -> form ------------------------------------------------------------------------------------------------

function sectionToValue(section: HomeSection): SectionValue {
  switch (section.type) {
    case "campaignHero":
      return { type: "campaignHero", headline: text(section.headline), subline: text(section.subline), actionLabel: text(section.actionLabel), target: encodeTarget(section.target) };
    case "collectionStory":
      return { type: "collectionStory", collectionId: section.collectionId, heading: text(section.heading), body: text(section.body) };
    case "productRail":
      return { type: "productRail", source: section.source, collectionId: section.collectionId ?? "", heading: text(section.heading) };
    case "categoryTiles":
      return { type: "categoryTiles", categoryIds: [...section.categoryIds], heading: text(section.heading) };
    case "editorialBand":
      return { type: "editorialBand", collectionId: section.collectionId, headline: text(section.headline) };
    case "assuranceStrip":
      return { type: "assuranceStrip" };
  }
}

/** The saved draft -> form values; nothing saved yet -> the create defaults (an empty draft). */
export function mapStorefrontContentToFormValues(oldData?: Pick<StorefrontContentAdminView, "draft">): StorefrontContentFormValues {
  const draft = oldData?.draft;
  return {
    announcements: (draft?.announcements ?? []).map((item) => ({
      message: text(item.message),
      target: encodeTarget(item.target),
      startsAt: item.startsAt ?? "",
      endsAt: item.endsAt ?? "",
      enabled: item.enabled,
    })),
    headerNavigation: (draft?.headerNavigation ?? []).map((item) => ({ target: encodeTarget(item.target), label: text(item.label) })),
    footerNavigation: (draft?.footerNavigation ?? []).map((item) => ({ target: encodeTarget(item.target), label: text(item.label) })),
    homeSections: (draft?.homeSections ?? []).map(sectionToValue),
  };
}

// --- form -> API ------------------------------------------------------------------------------------------------

function announcementToBody(value: AnnouncementValue): Announcement {
  return defined({ message: clean(value.message), target: decodeTarget(value.target), startsAt: isoOrUndefined(value.startsAt), endsAt: isoOrUndefined(value.endsAt), enabled: value.enabled });
}

/**
 * A row with no chosen target is refused by the form first (the field is required). Should one get through, an
 * empty id makes the server name `...target.id` rather than this dropping the row without a word.
 */
function navItemToBody(value: NavItemValue): NavItem {
  return defined({ target: decodeTarget(value.target) ?? { kind: "page" as const, id: "" }, label: optionalText(value.label) });
}

function sectionToBody(value: SectionValue): HomeSection {
  switch (value.type) {
    case "campaignHero":
      return defined({ type: "campaignHero" as const, headline: clean(value.headline), subline: optionalText(value.subline), actionLabel: optionalText(value.actionLabel), target: decodeTarget(value.target) });
    case "collectionStory":
      return defined({ type: "collectionStory" as const, collectionId: value.collectionId, heading: optionalText(value.heading), body: optionalText(value.body) });
    case "productRail":
      return defined({ type: "productRail" as const, source: value.source, collectionId: value.source === "collection" ? value.collectionId || undefined : undefined, heading: optionalText(value.heading) });
    case "categoryTiles":
      return defined({ type: "categoryTiles" as const, categoryIds: [...value.categoryIds], heading: optionalText(value.heading) });
    case "editorialBand":
      return { type: "editorialBand", collectionId: value.collectionId, headline: clean(value.headline) };
    case "assuranceStrip":
      return { type: "assuranceStrip" };
  }
}

export function toSaveBody(values: StorefrontContentFormValues): StorefrontContentBody {
  return {
    announcements: values.announcements.map(announcementToBody),
    headerNavigation: values.headerNavigation.map(navItemToBody),
    footerNavigation: values.footerNavigation.map(navItemToBody),
    homeSections: values.homeSections.map(sectionToBody),
  };
}

// --- Readable problem labels ------------------------------------------------------------------------------------

export const SECTION_LABELS: Record<HomeSectionType, string> = {
  campaignHero: "Campaign hero",
  collectionStory: "Collection story",
  productRail: "Product rail",
  categoryTiles: "Category tiles",
  editorialBand: "Editorial band",
  assuranceStrip: "Assurance strip",
};

const LIST_LABELS: Record<string, string> = { announcements: "Announcement", headerNavigation: "Header link", footerNavigation: "Footer link", homeSections: "Section" };

const FIELD_LABELS: Record<string, string> = {
  message: "Message",
  target: "Link",
  startsAt: "Start",
  endsAt: "End",
  enabled: "Shown",
  label: "Link text",
  type: "Section type",
  headline: "Headline",
  subline: "Subline",
  actionLabel: "Button text",
  collectionId: "Collection",
  categoryIds: "Categories",
  heading: "Heading",
  body: "Body",
  source: "Source",
  draftRevision: "Draft",
};

const LOCALE_LABELS: Record<string, string> = { ar: "Arabic", en: "English" };

/**
 * `homeSections.2.collectionId` -> `Section 3 (Product rail) · Collection`. The section's type is read from the
 * draft the problem is about, so staff see the card they are looking at, not an array index.
 */
export function describeProblemField(path: string, sections: ReadonlyArray<{ type: HomeSectionType }> = []): string {
  const [list, rawIndex, ...rest] = path.split(".");
  const where = LIST_LABELS[list ?? ""];
  if (!where || rawIndex === undefined || !/^\d+$/.test(rawIndex)) return FIELD_LABELS[path] ?? path;
  const index = Number(rawIndex);
  const sectionType = list === "homeSections" ? sections[index]?.type : undefined;
  const head = `${where} ${index + 1}${sectionType ? ` (${SECTION_LABELS[sectionType]})` : ""}`;
  const parts = rest.filter((part) => part !== "id" && part !== "kind");
  const tail = parts.map((part) => LOCALE_LABELS[part] ?? FIELD_LABELS[part] ?? (/^\d+$/.test(part) ? `item ${Number(part) + 1}` : part));
  // "Headline · Arabic": the locale reads as a qualifier of the field before it.
  const field = tail.length > 1 && parts[parts.length - 1] && LOCALE_LABELS[parts[parts.length - 1]!] ? `${tail.slice(0, -1).join(" ")} (${tail[tail.length - 1]})` : tail.join(" ");
  return field ? `${head} · ${field}` : head;
}
