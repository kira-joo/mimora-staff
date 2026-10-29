import { createGetRoute, createPostRoute } from "src/server/core/route-factories";
import { claimIdempotentMutation, completeIdempotentMutation, releaseIdempotentMutation } from "src/server/core/idempotency/scoped-idempotency";
import { RATE_LIMITS, enforceRateLimit } from "src/server/core/rate-limit/enforce-rate-limit";
import { RequestReturnDto } from "src/server/shop/dto/request-return.dto";
import { ListReturnsQueryDto } from "src/server/shop/dto/list-returns-query.dto";
import { requireCustomer } from "src/server/shop/shop-actor";
import { requestReturn } from "src/server/shop/returns/request-return";
import { listReturns } from "src/server/shop/returns/list-returns";
import type { ReturnListItemView } from "src/server/shop/returns/returns.types";

const ROUTE = "POST /api/shop/returns";

/**
 * POST /api/shop/returns — customer requests a return.
 *
 * Not nested under `/orders/[orderNumber]` — `orderNumber` is a body field
 * (MDS's own route shape: `POST /returns`, sibling to `/orders`, not a
 * child of it).
 *
 * MDS does not annotate this route `(idempotent)` the way it does Orders
 * and Payment Proof, but a return request is not naturally idempotent the
 * way `cancel-order` is: nothing about a brand-new `Return` document lets a
 * retry recognise "this already happened" on its own. Scoped idempotency
 * is applied as an additional safety measure against a double-submit
 * creating two returns for the same lines.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 201,
  body: RequestReturnDto,
  handler: async ({ request, body }) => {
    const customer = await requireCustomer(request);

    await enforceRateLimit({ key: `RETURN_REQUEST:${customer._id}`, ...RATE_LIMITS.RETURN_REQUEST });

    const claim = await claimIdempotentMutation({ route: ROUTE, actorId: customer._id, request, body });
    if (!claim.claimed) return claim.cachedResponse!.body as ReturnListItemView;

    try {
      const result = await requestReturn({
        customer,
        orderNumber: body.orderNumber,
        reason: body.reason,
        lines: body.lines,
        now: new Date(),
      });

      await completeIdempotentMutation(claim, { status: 201, body: result });
      return result;
    } catch (error) {
      await releaseIdempotentMutation(claim);
      throw error;
    }
  },
});

/**
 * GET /api/shop/returns — list the customer's own return history.
 */
export const GET = createGetRoute({
  auth: false,
  query: ListReturnsQueryDto,
  handler: async ({ request, query }) => {
    const customer = await requireCustomer(request);

    return listReturns({ customer, limit: query.limit, offset: query.offset });
  },
});

export const dynamic = "force-dynamic";
