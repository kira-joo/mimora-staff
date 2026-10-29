import { getCategories } from "src/server/storefront/get-categories";
import { createGetRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  auth: false,
  handler: async () => getCategories(),
});
