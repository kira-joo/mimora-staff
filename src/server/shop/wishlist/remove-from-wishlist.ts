import { buildWishlistKey } from "../../commerce/wishlist.schema";
import { wishlistRepository } from "../../core/repositories";

/**
 * Removes a product from the customer's wishlist.
 *
 * **Idempotent:** Removing a product that isn't in the wishlist is a no-op.
 * No error thrown — the desired state (product not in wishlist) is achieved.
 *
 * Hard delete — no soft-delete flag. Wishlist entries are simple reference data.
 */
export async function removeFromWishlist(customerId: string, productId: string): Promise<void> {
  const customerProductKey = buildWishlistKey(customerId, productId);
  await wishlistRepository.delete({ where: { customerProductKey }, skipThrowError: true });
  // No error on a miss — idempotent by design
}
