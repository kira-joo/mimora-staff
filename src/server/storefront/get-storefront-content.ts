import { storefrontContentRepository } from "../core/repositories";
import { resolveStorefrontContent, type StorefrontContentView } from "../content/resolve-storefront-content";
import { EMPTY_STOREFRONT_CONTENT } from "../content/storefront-content.types";

/**
 * What customers see: the **published** content only — a saved draft is
 * never served here — resolved against what is published now. Before the
 * first publish, an empty body: the storefront then shows its designed
 * fallback home (design-system.md §13a) and the legal links, which are
 * always present.
 */
export async function getStorefrontContent(now: Date): Promise<StorefrontContentView> {
  const record = await storefrontContentRepository.findOne({ where: {}, select: { published: true, publishedAt: true }, skipThrowError: true, lean: true });
  return resolveStorefrontContent(record?.published ?? EMPTY_STOREFRONT_CONTENT, now, record?.publishedAt ?? null);
}
