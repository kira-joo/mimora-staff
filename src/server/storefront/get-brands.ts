import { brandRepository } from "../core/repositories";
import type { BrandSchema } from "../catalog/brand.schema";

/** No `sortOrder` field on `Brand` (unlike Category/Collection) — the repository's own default sort (`{createdAt: -1}`, per this repo's stated convention) applies. */
export async function getBrands(): Promise<BrandSchema[]> {
  return brandRepository.findAll({ where: { published: true } });
}
