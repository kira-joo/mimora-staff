import { ListStorefrontProductsQueryDto } from "src/server/catalog/dto/list-storefront-products-query.dto";
import { getProducts } from "src/server/storefront/get-products";
import { createGetRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  query: ListStorefrontProductsQueryDto,
  auth: false,
  handler: async ({ query }) => getProducts(query),
});
