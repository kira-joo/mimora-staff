import { MongoIdParamsDto } from "src/server/catalog/dto/mongo-id-params.dto";
import { getSizeGuide } from "src/server/storefront/get-size-guide";
import { createGetRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  params: MongoIdParamsDto,
  auth: false,
  handler: async ({ params }) => getSizeGuide(params.id),
});
