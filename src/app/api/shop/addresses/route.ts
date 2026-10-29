import { createGetRoute, createPostRoute } from "src/server/core/route-factories";
import { RATE_LIMITS, enforceRateLimit } from "src/server/core/rate-limit/enforce-rate-limit";
import { requireCustomer } from "src/server/shop/shop-actor";
import { ListAddressesQueryDto } from "src/server/shop/dto/list-addresses-query.dto";
import { CreateAddressDto } from "src/server/shop/dto/create-address.dto";
import { listAddresses } from "src/server/shop/address/list-addresses";
import { createAddress } from "src/server/shop/address/create-address";

/**
 * GET /api/shop/addresses — lists the authenticated customer's addresses.
 *
 * Returns only addresses owned by the customer, sorted with default first,
 * then by creation date descending. Paginated.
 */
export const GET = createGetRoute({
  auth: false,
  query: ListAddressesQueryDto,
  handler: async ({ request, query }) => {
    const customer = await requireCustomer(request);
    return listAddresses(customer._id, {
      limit: query.limit ?? 50,
      skip: query.skip ?? 0,
    });
  },
});

/**
 * POST /api/shop/addresses — creates a new address.
 *
 * First address for a customer becomes default automatically.
 * Rate limited to prevent abuse.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 201,
  body: CreateAddressDto,
  handler: async ({ request, body }) => {
    const customer = await requireCustomer(request);

    await enforceRateLimit({ key: `ADDRESS_MUTATION:${customer._id}`, ...RATE_LIMITS.ADDRESS_MUTATION });

    return createAddress(customer._id, body);
  },
});

export const dynamic = "force-dynamic";
