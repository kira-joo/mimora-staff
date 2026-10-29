import { createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdateProductLifecycleDto } from "../../../../../../server/admin/dto/update-product-lifecycle.dto";
import { setProductLifecycle } from "../../../../../../server/admin/products/set-product-lifecycle";
import { AppPermission } from "../../../../../../common/authorization/authorization-registry";

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.PRODUCT.UPDATE] },
  params: MongoIdParamsDto,
  body: UpdateProductLifecycleDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ params, body }) => setProductLifecycle(params.id, body.lifecycle),
});
