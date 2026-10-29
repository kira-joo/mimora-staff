import { NotFoundError, ValidationFailedError } from "@kira-joo/backend-toolkit-core";
import { createHash } from "node:crypto";
import { createGetRoute, createPostRoute } from "src/server/core/route-factories";
import { claimIdempotentMutation, completeIdempotentMutation, releaseIdempotentMutation } from "src/server/core/idempotency/scoped-idempotency";
import { PlaceOrderDto } from "src/server/shop/dto/place-order.dto";
import { ListOrdersQueryDto } from "src/server/shop/dto/list-orders-query.dto";
import { requireCustomer, resolveShopActor } from "src/server/shop/shop-actor";
import { deriveOrderAccessToken } from "src/server/shop/order/order-access-token";
import { RATE_LIMITS, enforceRateLimit, resolveClientIp } from "src/server/core/rate-limit/enforce-rate-limit";
import { placeOrderService } from "src/server/shop/order/place-order";
import { listOrders } from "src/server/shop/order/list-orders";
import type { PlaceOrderView } from "src/server/shop/order/order.types";

const ROUTE = "POST /api/shop/orders";

/**
 * POST /api/shop/orders — place an order from the actor's active cart.
 *
 * A signed-in customer or a guest (`resolveShopActor`). A guest must send
 * `guestContact` and holds the cart by `x-cart-token`; a customer must NOT send
 * `guestContact` (an account never places an order "as" someone else). When the
 * store has turned guest checkout off, a guest gets 401 like any account-only
 * route. A guest order is a guest order: the phone is never looked up against
 * accounts and an account collision is never mentioned (D-9).
 *
 * Idempotency is scoped by route + actor + the client's `Idempotency-Key`
 * header; a guest's actor is `guest:` + the SHA-256 of their cart token (the
 * raw token is a credential and is never stored in a key).
 *
 * Rate limited by IP, and additionally by customer id for a customer.
 *
 * Request body: { paymentMethod, termsVersionAccepted, notes?, guestContact? }
 * Response: PlaceOrderView — plus `accessToken` for guest orders only. The
 * token is added after the idempotency record is written, so a replay returns
 * the same token without it ever being stored.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 201,
  body: PlaceOrderDto,
  /*
   * Placing an order decrements per-variant stock and rewrites the products' listing rollups (purchasable count,
   * available options, low-stock facts) that the storefront's ISR listing and detail pages show. Declared here, never
   * in the repository: the factory publishes it only when the transaction committed and the handler returned.
   */
  revalidateTags: ["PRODUCTS"],
  handler: async ({ request, body }) => {
    const actor = await resolveShopActor(request);

    if (actor.kind === "customer" && body.guestContact) {
      throw new ValidationFailedError([{ field: "guestContact", messages: ["guestContact must not be sent by a signed-in customer."] }]);
    }
    if (actor.kind === "guest" && !body.guestContact) {
      throw new ValidationFailedError([{ field: "guestContact", messages: ["guestContact is required to place an order without an account."] }]);
    }
    if (actor.kind === "guest" && !actor.cartToken) {
      throw new NotFoundError("No cart exists yet — add a line first.");
    }

    await enforceRateLimit({ key: `ORDER_PLACEMENT:ip:${resolveClientIp(request)}`, ...RATE_LIMITS.ORDER_PLACEMENT });
    if (actor.kind === "customer") {
      await enforceRateLimit({ key: `ORDER_PLACEMENT:customer:${actor.customer._id}`, ...RATE_LIMITS.ORDER_PLACEMENT });
    }

    const actorId = actor.kind === "customer" ? actor.customer._id : `guest:${createHash("sha256").update(actor.cartToken!).digest("hex")}`;
    const claim = await claimIdempotentMutation({ route: ROUTE, actorId, request, body });

    const withAccessToken = (view: PlaceOrderView): PlaceOrderView => (actor.kind === "guest" ? { ...view, accessToken: deriveOrderAccessToken(view.orderId) } : view);
    if (!claim.claimed) return withAccessToken(claim.cachedResponse!.body as PlaceOrderView);

    const acceptLanguage = request.headers.get("accept-language")?.split(",")[0]?.split("-")[0];
    const locale: "en" | "ar" = acceptLanguage === "ar" ? "ar" : "en";

    try {
      const common = { paymentMethod: body.paymentMethod, notes: body.notes || undefined, termsVersionAccepted: body.termsVersionAccepted, idempotencyKey: claim.key, locale, now: new Date() };
      const result = await placeOrderService(
        actor.kind === "customer"
          ? { ...common, customer: actor.customer }
          : { ...common, guest: { cartToken: actor.cartToken!, contact: body.guestContact! } }
      );

      await completeIdempotentMutation(claim, { status: 201, body: result });
      return withAccessToken(result);
    } catch (error) {
      await releaseIdempotentMutation(claim);
      throw error;
    }
  },
});

/**
 * GET /api/shop/orders — list customer's order history.
 *
 * Requires customer auth.
 *
 * Query params: limit?, offset?
 * Response: OrderListItemView[]
 */
export const GET = createGetRoute({
  auth: false,
  query: ListOrdersQueryDto,
  handler: async ({ request, query }) => {
    const customer = await requireCustomer(request);

    return listOrders({ customer, limit: query.limit, offset: query.offset });
  },
});

export const dynamic = "force-dynamic";
