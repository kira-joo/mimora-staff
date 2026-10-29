import { createGetRoute, createPutRoute, createDeleteRoute } from "src/server/core/route-factories";
import { RATE_LIMITS, enforceRateLimit } from "src/server/core/rate-limit/enforce-rate-limit";
import { requireCustomer } from "src/server/shop/shop-actor";
import { AddressIdParamsDto } from "src/server/shop/dto/address-id-params.dto";
import { UpdateAddressDto } from "src/server/shop/dto/update-address.dto";
import { getAddress } from "src/server/shop/address/get-address";
import { updateAddress } from "src/server/shop/address/update-address";
import { deleteAddress } from "src/server/shop/address/delete-address";

/**
 * GET /api/shop/addresses/[id] — fetches a single address.
 *
 * Ownership check: returns 404 for addresses owned by other customers.
 */
export const GET = createGetRoute({
  auth: false,
  params: AddressIdParamsDto,
  handler: async ({ request, params }) => {
    const customer = await requireCustomer(request);
    return getAddress(customer._id, params.id);
  },
});

/**
 * PUT /api/shop/addresses/[id] — updates an address.
 *
 * Ownership check enforced. Rate limited.
 */
export const PUT = createPutRoute({
  auth: false,
  params: AddressIdParamsDto,
  body: UpdateAddressDto,
  handler: async ({ request, params, body }) => {
    const customer = await requireCustomer(request);

    await enforceRateLimit({ key: `ADDRESS_MUTATION:${customer._id}`, ...RATE_LIMITS.ADDRESS_MUTATION });

    return updateAddress(customer._id, params.id, body);
  },
});

/**
 * DELETE /api/shop/addresses/[id] — deletes an address.
 *
 * Ownership check enforced. Rate limited. Hard delete.
 */
export const DELETE = createDeleteRoute({
  auth: false,
  params: AddressIdParamsDto,
  handler: async ({ request, params }) => {
    const customer = await requireCustomer(request);

    await enforceRateLimit({ key: `ADDRESS_MUTATION:${customer._id}`, ...RATE_LIMITS.ADDRESS_MUTATION });

    await deleteAddress(customer._id, params.id);
    return { message: "Address deleted successfully" };
  },
});

export const dynamic = "force-dynamic";
