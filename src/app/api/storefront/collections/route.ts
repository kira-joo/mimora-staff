import { getCollections } from "src/server/storefront/get-collections";
import { createGetRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  auth: false,
  handler: async () => getCollections(),
});
