import { SortOrder } from "@kira-joo/toolkit-common";
import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { catalogImportBatchRepository } from "../../core/repositories";
import type { CatalogImportBatchSchema } from "../../catalog/catalog-import-batch.schema";
import type { ListAdminCatalogImportsQueryDto } from "../dto/list-admin-catalog-imports-query.dto";

/** Newest first, without the staged rows — a list shows what each batch is, not its contents (that is `GET /:id`). */
export async function listCatalogImports(query: ListAdminCatalogImportsQueryDto): Promise<PaginatedResponse<Omit<CatalogImportBatchSchema, "rows">>> {
  const { status, ...rest } = query;
  const result = await catalogImportBatchRepository.findAllAndCountPublic({
    where: status ? { status } : {},
    select: { status: true, filename: true, summary: true, stagedBy: true, publishedBy: true, publishedAt: true, createdAt: true, updatedAt: true } as never,
    sort: { field: "createdAt", order: SortOrder.DESC },
    query: rest,
  });
  return result as PaginatedResponse<Omit<CatalogImportBatchSchema, "rows">>;
}
