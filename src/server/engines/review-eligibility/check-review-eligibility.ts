import { isCompletedStatus } from "../order-state/order-state-machine";
import type { OrderStatus } from "../order-state/order-state.types";

export interface ReviewableOrder {
  customerId: string;
  status: OrderStatus;
  /** Product ids purchased on this order — one entry per order line. */
  productIds: string[];
}

/**
 * A review requires a **delivered** (or, for pickup, **collected**) order for
 * this customer containing this product. Enforced here, not the UI — the storefront hides the "write a
 * review" control for a product a customer never bought, but hiding a
 * control is presentation, not enforcement, and this is the check that
 * actually gates the write.
 *
 * Pure: the caller supplies the customer's own orders (already scoped to
 * that customer by the repository query) rather than this engine querying
 * anything itself.
 */
export function canReviewProduct(productId: string, orders: ReviewableOrder[]): boolean {
  return orders.some((order) => isCompletedStatus(order.status) && order.productIds.includes(productId));
}
