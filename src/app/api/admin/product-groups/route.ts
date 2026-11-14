import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";
import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ProductGroupNameDto } from "../../../../server/admin/dto/product-group.dto";
import { listProductGroups } from "../../../../server/admin/product-groups/list-product-groups";
import { createProductGroup } from "../../../../server/admin/product-groups/create-product-group";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PRODUCT_GROUP.READ] },
  query: BaseFindQueryDto,
  handler: async ({ query }) => listProductGroups(query),
});

/** An empty group changes nothing a customer sees, so creating one publishes no invalidation. */
export const POST = createPostRoute({
  auth: { permissions: [AppPermission.PRODUCT_GROUP.CREATE] },
  body: ProductGroupNameDto,
  handler: async ({ body }) => createProductGroup({ name: body.name }),
});
