import { getStoreIdentity } from "src/server/storefront/get-store-identity";
import { createGetRoute } from "src/server/core/route-factories";

/**
 * `/api/storefront/**` is `auth: false` by design — see `store-profile/route.ts`; both halves are required.
 *
 * Never cached: the answer is only meaningful if it was verified against the database at the moment it is read,
 * so a stale copy would defeat the check the storefront makes with it. No `revalidateTags` for the same reason.
 */
export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  auth: false,
  handler: async () => getStoreIdentity(),
});
