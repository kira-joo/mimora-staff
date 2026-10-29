import { getStoreProfile } from "src/server/storefront/get-store-profile";
import { createGetRoute } from "src/server/core/route-factories";

/**
 * `/api/storefront/**` is `auth: false` by design — every route on this
 * surface is public, cached by the consumer's own tags, never this
 * backend's. **Both halves are required**: `auth: false` alone still lets
 * Next attempt static generation against this route, which fails the build
 * the moment the database is unreachable at build time.
 */
export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  auth: false,
  handler: async () => getStoreProfile(),
});
