import { createGetRoute, createPutRoute } from "src/server/core/route-factories";
import { RATE_LIMITS, enforceRateLimit } from "src/server/core/rate-limit/enforce-rate-limit";
import { UpdateProfileDto } from "src/server/shop/dto/update-profile.dto";
import { requireCustomer } from "src/server/shop/shop-actor";
import { getProfile } from "src/server/shop/profile/get-profile";
import { updateProfile } from "src/server/shop/profile/update-profile";

/** GET /api/shop/profile — the authenticated customer's own profile (public fields only). */
export const GET = createGetRoute({
  auth: false,
  handler: async ({ request }) => getProfile((await requireCustomer(request))._id),
});

/**
 * PUT /api/shop/profile — updates the authenticated customer's profile.
 *
 * Updates name and email. Email must be unique (sparse index).
 * Rate limited to prevent abuse.
 */
export const PUT = createPutRoute({
  auth: false,
  body: UpdateProfileDto,
  handler: async ({ request, body }) => {
    const customer = await requireCustomer(request);

    await enforceRateLimit({ key: `PROFILE_UPDATE:${customer._id}`, ...RATE_LIMITS.PROFILE_UPDATE });

    return updateProfile(customer._id, {
      name: body.name,
      email: body.email,
    });
  },
});

export const dynamic = "force-dynamic";
