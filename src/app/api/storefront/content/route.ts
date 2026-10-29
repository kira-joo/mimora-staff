import { getStorefrontContent } from "src/server/storefront/get-storefront-content";
import { createGetRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

/** Published storefront content — announcement, navigation, legal links, home sections. See `StorefrontContentView` for the cache tags a consumer must use. */
export const GET = createGetRoute({
  auth: false,
  handler: async () => getStorefrontContent(new Date()),
});
