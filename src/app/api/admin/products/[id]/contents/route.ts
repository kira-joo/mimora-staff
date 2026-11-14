import { createGetRoute, createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { SetProductContentsDto } from "../../../../../../server/admin/dto/product-contents.dto";
import { readProductContents } from "../../../../../../server/admin/product-contents/product-contents-views";
import { setProductContents } from "../../../../../../server/admin/product-contents/set-product-contents";
import { AppPermission } from "../../../../../../common/authorization/authorization-registry";

/** What a product contains ("what's inside" a gift box), each entry with the included product's live fields. */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PRODUCT.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => readProductContents(params.id),
});

/** Replaces the product's whole contents list in one transaction. The box's page shows it, so this publishes PRODUCTS. */
export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.PRODUCT.UPDATE] },
  params: MongoIdParamsDto,
  body: SetProductContentsDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ params, body }) => setProductContents(params.id, body.items),
});
