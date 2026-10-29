import { StorefrontSearchQueryDto } from "src/server/catalog/dto/storefront-search-query.dto";
import { searchProducts } from "src/server/storefront/search-products";
import { createGetRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  query: StorefrontSearchQueryDto,
  auth: false,
  handler: async ({ query }) => searchProducts(query),
});
