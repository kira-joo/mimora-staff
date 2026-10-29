import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { variantRepository } from "../../core/repositories";
import type { VariantSchema } from "../../catalog/variant.schema";
import type { ListAdminVariantsQueryDto } from "../dto/list-admin-variants-query.dto";

export async function listVariants(query: ListAdminVariantsQueryDto): Promise<PaginatedResponse<VariantSchema>> {
  const { productId, discontinued, ...rest } = query;
  const where: Record<string, unknown> = {};

  if (productId) where.productId = productId;
  if (discontinued !== undefined) where.discontinued = discontinued;

  return variantRepository.findAllAndCountPublic({ where, query: rest });
}
