import { getOperatingHours } from "src/server/storefront/get-operating-hours";
import { createGetRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  auth: false,
  handler: async () => getOperatingHours(),
});
