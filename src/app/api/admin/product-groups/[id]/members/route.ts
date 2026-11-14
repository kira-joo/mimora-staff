import { createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { SetProductGroupMembersDto } from "../../../../../../server/admin/dto/product-group.dto";
import { setProductGroupMembers } from "../../../../../../server/admin/product-groups/set-product-group-members";
import { AppPermission } from "../../../../../../common/authorization/authorization-registry";

/**
 * Replaces the group's membership (add, remove, reorder, relabel, move in from another group) in one transaction.
 * Every member's product page shows the group, so this publishes PRODUCTS.
 */
export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.PRODUCT_GROUP.UPDATE] },
  params: MongoIdParamsDto,
  body: SetProductGroupMembersDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ params, body }) => setProductGroupMembers(params.id, { expectedRevision: body.expectedRevision, members: body.members }),
});
