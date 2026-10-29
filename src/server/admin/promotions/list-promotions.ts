import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { promotionRepository } from "../../core/repositories";
import type { PromotionSchema } from "../../commerce/promotion.schema";
import type { ListAdminPromotionsQueryDto } from "../dto/list-admin-promotions-query.dto";

export async function listPromotions(query: ListAdminPromotionsQueryDto): Promise<PaginatedResponse<PromotionSchema>> {
  const { active, type, ...rest } = query;
  const where: Record<string, unknown> = {};

  if (active !== undefined) where.active = active;
  if (type) where.type = type;

  return promotionRepository.findAllAndCountPublic({ where, query: rest });
}
