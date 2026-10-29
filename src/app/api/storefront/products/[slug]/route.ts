import { SlugParamsDto } from "src/server/catalog/dto/slug-params.dto";
import { getProductDetail } from "src/server/storefront/get-product-detail";
import { createGetRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  params: SlugParamsDto,
  auth: false,
  handler: async ({ params }) => getProductDetail(params.slug),
});
