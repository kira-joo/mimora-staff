import { createPutRoute } from "src/server/core/route-factories";
import { RATE_LIMITS, enforceRateLimit } from "src/server/core/rate-limit/enforce-rate-limit";
import { SetMarketingConsentDto } from "src/server/shop/dto/set-marketing-consent.dto";
import { setMarketingConsent } from "src/server/shop/profile/marketing-consent";
import { requireCustomer } from "src/server/shop/shop-actor";

/**
 * PUT /api/shop/profile/marketing-consent — grant or withdraw the signed-in
 * customer's marketing consent. One control, effective immediately; a withdrawal
 * also unsubscribes the newsletter row. Idempotent: repeating the current state
 * changes nothing. Returns the resulting consent state.
 */
export const PUT = createPutRoute({
  auth: false,
  body: SetMarketingConsentDto,
  handler: async ({ request, body }) => {
    const customer = await requireCustomer(request);
    await enforceRateLimit({ key: `PROFILE_UPDATE:${customer._id}`, ...RATE_LIMITS.PROFILE_UPDATE });
    return setMarketingConsent(customer._id, { granted: body.granted, source: body.source ?? "account", locale: body.locale });
  },
});

export const dynamic = "force-dynamic";
