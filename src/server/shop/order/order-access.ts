import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { extractAuthToken } from "@kira-joo/backend-toolkit-next";
import { resolveCustomerFromAccessToken, type CustomerIdentity } from "../../core/auth/resolve-customer";
import { CUSTOMER_SESSION_COOKIE } from "../../core/auth/customer-session-cookies";
import { orderRepository } from "../../core/repositories";
import type { OrderSchema } from "../../commerce/order.schema";
import { isValidOrderAccessToken } from "./order-access-token";

export const ORDER_ACCESS_TOKEN_HEADER = "x-order-access-token";

/** Who is acting on an order: its owning customer, or a guest holding the order's access token. */
export type OrderOwner = { customer: CustomerIdentity; guestOrderId?: undefined } | { guestOrderId: string; customer?: undefined };

/** The Mongo filter that finds an order only for its rightful owner — the one place ownership is expressed to the database. */
export function orderOwnerFilter(owner: OrderOwner, orderNumber: string): Record<string, unknown> {
  return owner.customer ? { orderNumber, customerId: owner.customer._id } : { orderNumber, _id: owner.guestOrderId };
}

export interface ResolvedOrderAccess {
  order: OrderSchema;
  owner: OrderOwner;
}

/**
 * The guard for every `/api/shop/orders/[orderNumber]/**` route: returns the
 * order when (a) a valid customer session owns it, or (b) the
 * `x-order-access-token` header is that guest order's token.
 *
 * Anything else — no credentials, a wrong token, another customer's order,
 * a token for a different order — is the SAME 404 as an order that does not
 * exist, so the response never reveals whether an order number is real. A
 * present-but-invalid customer session is still a 401, consistent with
 * `resolveShopActor` (an expired session should read as a session problem,
 * not as a vanished order). A token only ever opens a GUEST order; a
 * customer-owned order is reachable by its owner's session alone.
 */
export async function resolveOrderAccess(request: Request, orderNumber: string): Promise<ResolvedOrderAccess> {
  const sessionToken = extractAuthToken(request, { source: "cookie", cookieName: CUSTOMER_SESSION_COOKIE });
  const customer = sessionToken ? await resolveCustomerFromAccessToken(sessionToken) : undefined;

  const order = await orderRepository.findOne({ where: { orderNumber }, skipThrowError: true });
  if (!order) throw new NotFoundError("Order not found.");

  if (customer && order.customerId?.toString() === customer._id) {
    return { order, owner: { customer } };
  }

  if (!order.customerId && isValidOrderAccessToken(order._id.toString(), request.headers.get(ORDER_ACCESS_TOKEN_HEADER))) {
    return { order, owner: { guestOrderId: order._id.toString() } };
  }

  throw new NotFoundError("Order not found.");
}
