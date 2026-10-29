import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { pageRepository } from "../../core/repositories";
import type { PageSchema } from "../../content/page.schema";
import type { ListAdminPagesQueryDto } from "../dto/list-admin-pages-query.dto";

export async function listPages(query: ListAdminPagesQueryDto): Promise<PaginatedResponse<PageSchema>> {
  const { published, ...rest } = query;
  const where: Record<string, unknown> = {};
  if (published !== undefined) where.published = published;

  return pageRepository.findAllAndCountPublic({ where, query: rest });
}
