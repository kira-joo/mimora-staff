import { StorefrontFacetsQueryDto } from "src/server/catalog/dto/storefront-facets-query.dto";
import { getFacets } from "src/server/storefront/get-facets";
import { createGetRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  query: StorefrontFacetsQueryDto,
  auth: false,
  handler: async ({ query }) => getFacets({ search: query.search, categoryId: query.categoryId, collectionId: query.collectionId }),
});
