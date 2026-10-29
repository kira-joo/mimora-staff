import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { brandRepository } from "../../core/repositories";
import type { BrandSchema } from "../../catalog/brand.schema";
import type { ListAdminBrandsQueryDto } from "../dto/list-admin-brands-query.dto";

export async function listBrands(query: ListAdminBrandsQueryDto): Promise<PaginatedResponse<BrandSchema>> {
  const { published, ...rest } = query;
  const where: Record<string, unknown> = {};
  if (published !== undefined) where.published = published;

  return brandRepository.findAllAndCountPublic({ where, query: rest });
}
