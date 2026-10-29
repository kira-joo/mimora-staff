import { ConflictError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedString } from "@kira-joo/toolkit-common";
import { brandRepository } from "../../core/repositories";
import type { BrandSchema } from "../../catalog/brand.schema";

export interface UpdateBrandInput {
  name?: LocalizedString;
  slug?: string;
  description?: LocalizedString;
  published?: boolean;
}

export async function updateBrand(brandId: string, input: UpdateBrandInput): Promise<BrandSchema> {
  const brand = await brandRepository.findOne({ where: { _id: brandId } });

  if (input.slug && input.slug !== brand.slug) {
    const existing = await brandRepository.findOne({
      where: { slug: input.slug, _id: { $ne: brandId } },
      skipThrowError: true,
    });
    if (existing) {
      throw new ConflictError("Brand slug already exists");
    }
  }

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.description !== undefined) patch.description = input.description;
  if (input.published !== undefined) patch.published = input.published;

  return brandRepository.update({ where: { _id: brandId } }, patch);
}
