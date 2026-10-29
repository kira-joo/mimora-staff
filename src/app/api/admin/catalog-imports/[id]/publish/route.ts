import { createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { publishCatalogImportBatch } from "../../../../../../server/admin/catalog-import/publish-catalog-import-batch";
import { CustomPermission } from "../../../../../../common/authorization/authorization-registry";

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.CATALOG_PUBLISH] },
  params: MongoIdParamsDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ params, user }) => {
    const batch = await publishCatalogImportBatch(params.id, user._id);
    return batch;
  },
});
