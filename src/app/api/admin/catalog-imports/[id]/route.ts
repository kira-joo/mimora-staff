import { createDeleteRoute, createGetRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { discardCatalogImportBatch } from "../../../../../server/admin/catalog-import/discard-catalog-import-batch";
import { catalogImportBatchRepository } from "../../../../../server/core/repositories";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

/** One batch with its staged rows, errors and warnings — the preview. */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.CATALOG_IMPORT_BATCH.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => catalogImportBatchRepository.findOne({ where: { _id: params.id } }),
});

export const DELETE = createDeleteRoute({
  auth: { permissions: [AppPermission.CATALOG_IMPORT_BATCH.DELETE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    await discardCatalogImportBatch(params.id);
    return;
  },
});
