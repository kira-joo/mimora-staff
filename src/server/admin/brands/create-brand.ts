import { ConflictError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedString } from "@kira-joo/toolkit-common";
import { brandRepository } from "../../core/repositories";
import type { BrandSchema } from "../../catalog/brand.schema";

export interface CreateBrandInput {
  name: LocalizedString;
  slug: string;
  description: LocalizedString;
  published?: boolean;
}

export async function createBrand(input: CreateBrandInput): Promise<BrandSchema> {
  const existing = await brandRepository.findOne({ where: { slug: input.slug }, skipThrowError: true });
  if (existing) {
    throw new ConflictError("Brand slug already exists");
  }

  return brandRepository.save({
    name: input.name,
    slug: input.slug,
    description: input.description,
    published: input.published ?? false,
  });
}
