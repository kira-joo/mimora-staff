import { SlugParamsDto } from "src/server/catalog/dto/slug-params.dto";
import { getPage } from "src/server/storefront/get-page";
import { createGetRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  params: SlugParamsDto,
  auth: false,
  handler: async ({ params }) => getPage(params.slug),
});
