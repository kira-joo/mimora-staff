import type { PurchasabilityInput, PurchasabilityResult } from "./purchasability.types";

/**
 * Whether a variant is orderable right now.
 *
 * Pure and cheap on purpose: this runs on every product-page render (via the
 * variant matrix engine) and again, authoritatively, at add-to-cart and at
 * placement — "the server re-validates regardless" (Phase 3 spec). A rejection
 * always names its cause, for the same reason the promotion engine's does: the
 * storefront's disabled "Add to cart" button needs a specific label, not a
 * generic "unavailable".
 *
 * Checked in structural order, most-fundamental first: a product that is not
 * published is not purchasable no matter what its variants say, and a
 * discontinued variant is not purchasable no matter its stock.
 */
export function resolvePurchasability(input: PurchasabilityInput): PurchasabilityResult {
  const requestedQuantity = input.requestedQuantity ?? 1;

  if (input.productLifecycle !== "published") {
    return { purchasable: false, reason: "NOT_PUBLISHED" };
  }

  if (input.discontinued) {
    return { purchasable: false, reason: "DISCONTINUED" };
  }

  /*
   * `CONTINUE_SELLING` means exactly what it says — stock is not consulted at
   * all. Partial-fulfilment workflow (what happens to the units that can't
   * ship) is v2; the field exists in v1 to let a merchant oversell
   * deliberately on a pre-order or made-to-order item.
   */
  if (input.backorderPolicy === "CONTINUE_SELLING") {
    return { purchasable: true };
  }

  if (input.stock < requestedQuantity) {
    return { purchasable: false, reason: "INSUFFICIENT_STOCK" };
  }

  return { purchasable: true };
}
