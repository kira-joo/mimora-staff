import type { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";
import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { productGroupRepository } from "../../core/repositories";
import type { ProductGroupSchema } from "../../catalog/product-group.schema";
import { countMembers } from "./product-group-views";

export type ProductGroupListItem = ProductGroupSchema & { memberCount: number };

/** Groups, newest first (the repository default for timestamped schemas), each with how many products it holds. */
export async function listProductGroups(query: BaseFindQueryDto): Promise<PaginatedResponse<ProductGroupListItem>> {
  const page = await productGroupRepository.findAllAndCountPublic({ where: {}, query });
  const counts = await countMembers(page.data.map((group) => group._id));
  return { ...page, data: page.data.map((group) => ({ ...(group as ProductGroupSchema), memberCount: counts.get(group._id.toString()) ?? 0 })) };
}
