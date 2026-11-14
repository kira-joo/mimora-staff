import { createDeleteRoute, createGetRoute, createPutRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { ProductGroupNameDto } from "../../../../../server/admin/dto/product-group.dto";
import { readProductGroupDetail } from "../../../../../server/admin/product-groups/product-group-views";
import { renameProductGroup } from "../../../../../server/admin/product-groups/rename-product-group";
import { deleteProductGroup } from "../../../../../server/admin/product-groups/delete-product-group";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PRODUCT_GROUP.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => readProductGroupDetail(params.id),
});

/** The name is staff-facing only — the storefront shows each member's label — so a rename invalidates nothing. */
export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.PRODUCT_GROUP.UPDATE] },
  params: MongoIdParamsDto,
  body: ProductGroupNameDto,
  handler: async ({ params, body }) => renameProductGroup(params.id, { name: body.name }),
});

/** Deletes the group and ungroups its members; the products themselves are kept. Their pages lose the switcher. */
export const DELETE = createDeleteRoute({
  auth: { permissions: [AppPermission.PRODUCT_GROUP.DELETE] },
  params: MongoIdParamsDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ params }) => {
    await deleteProductGroup(params.id);
    return;
  },
});
