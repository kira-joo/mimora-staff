import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { pageRepository } from "../core/repositories";
import type { PageSchema } from "../content/page.schema";

/**
 * An unpublished page is a 404, same as one that does not exist — the
 * storefront has no reason to distinguish the two.
 *
 * `version` is always present: a page written before versioning (D-13) has
 * no stored field and is version 1 — the same reading `placeOrderService`
 * applies when it checks an accepted terms version, so the number the
 * storefront shows is the number placement accepts.
 */
export async function getPage(slug: string): Promise<PageSchema> {
  const page = await pageRepository.findOne({ where: { slug, published: true }, skipThrowError: true, lean: true });
  if (!page) throw new NotFoundError(`Page "${slug}" was not found.`);
  return { ...page, version: page.version ?? 1 };
}
