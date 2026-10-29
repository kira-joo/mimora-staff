import { ConflictError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { pageRepository, pageRevisionRepository } from "../../core/repositories";
import type { PageSchema } from "../../content/page.schema";
import { revisionKey, revisionOf, sameLocalized } from "./page-revisions";
import { assertPagePublishable } from "../../content/page-publishable";

export interface UpdatePageInput {
  slug?: string;
  title?: LocalizedString;
  content?: LocalizedString;
  published?: boolean;
  seo?: { title?: LocalizedString; description?: LocalizedString; ogImage?: ImageAsset };
}

/**
 * Updates a page. A change to its text — `title` or `content` — is a new
 * version (D-13: "an edit creates a new version rather than mutating the old
 * one"): the version moves by one and the new text is kept as a
 * `PageRevision`, in one transaction with the page. Slug, publish state and
 * SEO are not the text a customer accepts, so they change in place.
 */
export async function updatePage(pageId: string, input: UpdatePageInput): Promise<PageSchema> {
  const page = await pageRepository.findOne({ where: { _id: pageId }, lean: true });

  if (input.slug && input.slug !== page.slug) {
    const existing = await pageRepository.findOne({ where: { slug: input.slug, _id: { $ne: pageId } }, skipThrowError: true });
    if (existing) {
      throw new ConflictError("Page slug already exists");
    }
  }

  const patch: Record<string, unknown> = {};
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.title !== undefined) patch.title = input.title;
  if (input.content !== undefined) patch.content = input.content;
  if (input.published !== undefined) patch.published = input.published;
  if (input.seo !== undefined) patch.seo = { ...page.seo, ...input.seo };

  // D-11: a page that is, or is becoming, published must carry its default locale.
  if (input.published ?? page.published) {
    await assertPagePublishable({ title: input.title ?? page.title, content: input.content ?? page.content, seo: { ...page.seo, ...input.seo } });
  }

  const textChanged = (input.title !== undefined && !sameLocalized(input.title, page.title)) || (input.content !== undefined && !sameLocalized(input.content, page.content));
  if (!textChanged) return pageRepository.update({ where: { _id: pageId } }, patch);

  return withTransaction(async (tx) => {
    // Re-read inside the transaction: a retry after a write conflict must
    // version from what is current now, not from the read above.
    const current = await pageRepository.findOne({ where: { _id: pageId }, lean: true });
    const currentVersion = current.version ?? 1;

    // A page written before versioning has no revision for its live text —
    // keep it before it is replaced, so the version it carries stays readable.
    const kept = await pageRevisionRepository.findOne({ where: { revisionKey: revisionKey(current._id, currentVersion) }, skipThrowError: true });
    if (!kept) await pageRevisionRepository.save(revisionOf({ ...current, version: currentVersion }));

    const updated = await pageRepository.updateAtomic({ _id: pageId }, { $set: { ...patch, version: currentVersion + 1 } });
    await pageRevisionRepository.save(revisionOf(updated));
    return tx.complete(updated);
  });
}
