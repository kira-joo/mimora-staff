import { getDeliveryZones } from "src/server/storefront/get-delivery-zones";
import { createGetRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  auth: false,
  handler: async () => getDeliveryZones(),
});
