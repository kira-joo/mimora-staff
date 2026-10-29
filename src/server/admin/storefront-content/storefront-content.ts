import { ConflictError, ValidationFailedError, type ValidationFieldError } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";
import { categoryRepository, collectionRepository, pageRepository, storefrontContentRepository } from "../../core/repositories";
import { defaultLocaleProblems } from "../../content/default-locale";
import { collectReferences, resolveStorefrontContent, type StorefrontContentView } from "../../content/resolve-storefront-content";
import { EMPTY_STOREFRONT_CONTENT, type HomeSection, type LinkKind, type LinkTarget, type StorefrontContentBody } from "../../content/storefront-content.types";
import type { LinkTargetDto, SaveStorefrontContentDraftDto } from "../dto/storefront-content.dto";

export interface StorefrontContentAdminView {
  draft: StorefrontContentBody;
  draftRevision: number;
  published: StorefrontContentBody | null;
  publishedRevision: number | null;
  publishedAt: Date | null;
  /** True when the draft differs from what customers see. */
  hasUnpublishedChanges: boolean;
}

export interface StorefrontContentPreview {
  /** The draft exactly as the storefront would show it if published now. */
  view: StorefrontContentView;
  /** The revision this preview is of — send it back to publish. */
  draftRevision: number;
  /** What would stop this draft publishing, by form field. Empty means it can go live. */
  problems: ValidationFieldError[];
}

async function readRecord() {
  return storefrontContentRepository.findOne({ where: {}, skipThrowError: true, lean: true });
}

function adminView(record: Awaited<ReturnType<typeof readRecord>>): StorefrontContentAdminView {
  const draftRevision = record?.draftRevision ?? 0;
  const publishedRevision = record?.publishedRevision ?? null;
  return {
    draft: record?.draft ?? EMPTY_STOREFRONT_CONTENT,
    draftRevision,
    published: record?.published ?? null,
    publishedRevision,
    publishedAt: record?.publishedAt ?? null,
    hasUnpublishedChanges: publishedRevision === null ? draftRevision > 0 : publishedRevision !== draftRevision,
  };
}

export async function getStorefrontContentAdmin(): Promise<StorefrontContentAdminView> {
  return adminView(await readRecord());
}

/**
 * Replaces the draft. Drafts may be incomplete — an untranslated headline,
 * a link to a collection not yet published — because that is what drafts
 * are for; only the structure is enforced here. Customers see nothing
 * until `publishStorefrontContent`.
 */
export async function saveStorefrontContentDraft(input: SaveStorefrontContentDraftDto): Promise<StorefrontContentAdminView> {
  const draft = toBody(input);
  assertDraftShape(draft);
  await storefrontContentRepository.updateAtomic({}, { $set: { draft }, $inc: { draftRevision: 1 } }, { upsert: true });
  return getStorefrontContentAdmin();
}

export async function previewStorefrontContentDraft(now: Date): Promise<StorefrontContentPreview> {
  const record = await readRecord();
  const draft = record?.draft ?? EMPTY_STOREFRONT_CONTENT;
  return { view: await resolveStorefrontContent(draft, now, null), draftRevision: record?.draftRevision ?? 0, problems: await publishProblems(draft) };
}

/**
 * Makes the previewed draft what customers see. Refused when:
 * - the draft has been saved since the merchant previewed it (409) — what
 *   goes live is what was checked;
 * - anything would show a customer a gap (400, by field): a link to
 *   something missing or unpublished, or text missing its default locale
 *   (D-11).
 *
 * One document, one conditional write: the copy happens only if the
 * draft is still the previewed revision at the instant of writing.
 */
export async function publishStorefrontContent(draftRevision: number, publishedBy: string, now: Date): Promise<StorefrontContentAdminView> {
  const record = await readRecord();
  if (!record || record.draftRevision !== draftRevision) throw staleDraft();

  const problems = await publishProblems(record.draft);
  if (problems.length > 0) throw new ValidationFailedError(problems);

  const written = await storefrontContentRepository.updateAtomic(
    { draftRevision },
    { $set: { published: record.draft, publishedRevision: draftRevision, publishedAt: now, publishedBy: new mongoose.Types.ObjectId(publishedBy) } },
    { skipThrowError: true }
  );
  if (!written) throw staleDraft();
  return getStorefrontContentAdmin();
}

function staleDraft() {
  return new ConflictError("The draft changed after it was previewed. Preview it again, then publish.", { field: "draftRevision", reason: "DRAFT_CHANGED" });
}

/** Everything that would show a customer a gap if this draft went live. */
async function publishProblems(draft: StorefrontContentBody): Promise<ValidationFieldError[]> {
  const references = collectReferences(draft);
  const live = await publishedIds(references.map((reference) => ({ kind: reference.kind, id: reference.id })));
  const broken = references
    .filter((reference) => !live[reference.kind].has(reference.id.toString()))
    .map((reference) => ({ field: reference.field, messages: [`This ${reference.kind} doesn't exist or isn't published, so customers couldn't open it.`] }));

  const required = (path: string) => {
    const [list, index, field] = path.split(".");
    if (list === "announcements") return field === "message";
    if (list !== "homeSections") return false;
    const section = draft.homeSections[Number(index)];
    if (field === "headline") return section?.type === "campaignHero" || section?.type === "editorialBand";
    return field === "actionLabel" && section?.type === "campaignHero" && !!section.target;
  };

  return [...broken, ...(await defaultLocaleProblems(draft, required))];
}

async function publishedIds(references: LinkTarget[]): Promise<Record<LinkKind, Set<string>>> {
  const ids = (kind: LinkKind) => [...new Set(references.filter((reference) => reference.kind === kind).map((reference) => reference.id.toString()))];
  const found = async (kind: LinkKind) => {
    const wanted = ids(kind);
    if (wanted.length === 0) return new Set<string>();
    const where = { _id: { $in: wanted }, published: true };
    const docs = kind === "category" ? await categoryRepository.findAll({ where, select: { _id: true }, lean: true }) : kind === "collection" ? await collectionRepository.findAll({ where, select: { _id: true }, lean: true }) : await pageRepository.findAll({ where, select: { _id: true }, lean: true });
    return new Set(docs.map((doc) => doc._id.toString()));
  };
  const [category, collection, page] = await Promise.all([found("category"), found("collection"), found("page")]);
  return { category, collection, page };
}

/** The rules the DTO cannot express per field: they span fields or items. */
export function assertDraftShape(draft: StorefrontContentBody): void {
  const errors: ValidationFieldError[] = [];
  const fail = (field: string, message: string) => errors.push({ field, messages: [message] });

  draft.announcements.forEach((item, index) => {
    if (item.startsAt && item.endsAt && item.endsAt <= item.startsAt) fail(`announcements.${index}.endsAt`, "The end must be after the start.");
  });

  draft.homeSections.forEach((section, index) => {
    if (section.type === "campaignHero" && index !== 0) fail(`homeSections.${index}.type`, "The campaign hero can only be the first section.");
    if (section.type === "assuranceStrip" && draft.homeSections.findIndex((other) => other.type === "assuranceStrip") !== index) fail(`homeSections.${index}.type`, "The assurance strip can only appear once.");
    if (section.type === "campaignHero" && !!section.actionLabel !== !!section.target) fail(`homeSections.${index}.target`, "A hero action needs both a label and a destination.");
    if (section.type === "productRail" && section.source === "collection" && !section.collectionId) fail(`homeSections.${index}.collectionId`, "Choose the collection this rail shows.");
    if (section.type === "productRail" && section.source === "newest" && section.collectionId) fail(`homeSections.${index}.collectionId`, "A newest-products rail does not take a collection.");
  });

  if (errors.length > 0) throw new ValidationFailedError(errors);
}

/** Request shape → stored shape: ids become ObjectIds, instants become Dates. */
function toBody(input: SaveStorefrontContentDraftDto): StorefrontContentBody {
  const id = (value: string) => new mongoose.Types.ObjectId(value);
  const target = (value: LinkTargetDto | undefined): LinkTarget | undefined => (value ? { kind: value.kind, id: id(value.id) } : undefined);
  const localized = (value: { ar: string; en: string } | undefined) => (value ? { ar: value.ar, en: value.en } : undefined);
  const compact = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

  return {
    announcements: input.announcements.map((item) =>
      compact({ message: { ar: item.message.ar, en: item.message.en }, target: target(item.target), startsAt: item.startsAt ? new Date(item.startsAt) : undefined, endsAt: item.endsAt ? new Date(item.endsAt) : undefined, enabled: item.enabled })
    ),
    headerNavigation: input.headerNavigation.map((item) => compact({ target: target(item.target)!, label: localized(item.label) })),
    footerNavigation: input.footerNavigation.map((item) => compact({ target: target(item.target)!, label: localized(item.label) })),
    homeSections: input.homeSections.map((section): HomeSection => {
      switch (section.type) {
        case "campaignHero":
          return compact({ type: section.type, headline: localized(section.headline)!, subline: localized(section.subline), actionLabel: localized(section.actionLabel), target: target(section.target) });
        case "collectionStory":
          return compact({ type: section.type, collectionId: id(section.collectionId), heading: localized(section.heading), body: localized(section.body) });
        case "productRail":
          return compact({ type: section.type, source: section.source, collectionId: section.collectionId ? id(section.collectionId) : undefined, heading: localized(section.heading) });
        case "categoryTiles":
          return compact({ type: section.type, categoryIds: section.categoryIds.map(id), heading: localized(section.heading) });
        case "editorialBand":
          return { type: section.type, collectionId: id(section.collectionId), headline: localized(section.headline)! };
        case "assuranceStrip":
          return { type: section.type };
      }
    }),
  };
}
