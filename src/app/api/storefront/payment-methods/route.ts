import { getPaymentMethods } from "src/server/storefront/get-payment-methods";
import { createGetRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

export const GET = createGetRoute({
  auth: false,
  handler: async () => getPaymentMethods(),
});
