import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";
import { ProductIdParamsDto } from "src/server/catalog/dto/mongo-id-params.dto";
import { getReviewsForProduct } from "src/server/storefront/get-reviews";
import { createGetRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  params: ProductIdParamsDto,
  query: BaseFindQueryDto,
  auth: false,
  handler: async ({ params, query }) => getReviewsForProduct(params.productId, query.page, query.limit),
});
