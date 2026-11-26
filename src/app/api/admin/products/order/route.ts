import { createGetRoute, createPutRoute } from "../../../../../server/core/route-factories";
import { ProductOrderScopeQueryDto, ReorderProductsDto } from "../../../../../server/admin/dto/product-order.dto";
import { listProductsForArrangement, reorderProducts } from "../../../../../server/admin/products/reorder-products";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

/** The products of one scope (a category with its descendants, a collection, or everything) in their manual order. */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PRODUCT.READ] },
  query: ProductOrderScopeQueryDto,
  handler: async ({ query }) => listProductsForArrangement(query),
});

/** Saves an arrangement of one scope; the rest of the catalogue keeps its places. The storefront's listings revalidate. */
export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.PRODUCT.UPDATE] },
  body: ReorderProductsDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ body }) => reorderProducts({ categoryId: body.categoryId, collectionId: body.collectionId }, body.productIds),
});
