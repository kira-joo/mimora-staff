import { ConflictError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { pageRepository, pageRevisionRepository } from "../../core/repositories";
import type { PageSchema } from "../../content/page.schema";
import { revisionOf } from "./page-revisions";
import { assertPagePublishable } from "../../content/page-publishable";

export interface CreatePageInput {
  slug: string;
  title: LocalizedString;
  content: LocalizedString;
  published?: boolean;
  seo?: { title?: LocalizedString; description?: LocalizedString; ogImage?: ImageAsset };
}

export async function createPage(input: CreatePageInput): Promise<PageSchema> {
  const existing = await pageRepository.findOne({ where: { slug: input.slug }, skipThrowError: true });
  if (existing) {
    throw new ConflictError("Page slug already exists");
  }
  if (input.published) await assertPagePublishable(input);

  // The page and the text of its first version, together or not at all (D-13).
  return withTransaction(async (tx) => {
    const page = await pageRepository.save({
      slug: input.slug,
      title: input.title,
      content: input.content,
      published: input.published ?? false,
      seo: input.seo ?? {},
      version: 1,
    });
    await pageRevisionRepository.save(revisionOf(page));
    return tx.complete(page);
  });
}
