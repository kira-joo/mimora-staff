import { DuplicateKeyError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { buildWishlistKey } from "../../commerce/wishlist.schema";
import { productRepository, wishlistRepository } from "../../core/repositories";

export interface AddToWishlistResult {
  _id: string;
  productId: string;
  addedAt: Date;
  alreadyExisted: boolean;
}

/**
 * Adds a product to the customer's wishlist.
 *
 * **Idempotent:** Adding the same product twice is a no-op. Returns
 * `alreadyExisted: true` when the entry already exists, `false` when created.
 *
 * The unique index on `customerProductKey` prevents duplicates at the database
 * level — a concurrent duplicate attempt throws a duplicate-key error, which
 * we catch and treat as success (the entry exists, which is what was requested).
 *
 * @throws {NotFoundError} Product does not exist or is not published.
 */
export async function addToWishlist(customerId: string, productId: string): Promise<AddToWishlistResult> {
  // Verify product exists and is published
  const product = await productRepository.findOne({ where: { _id: productId, lifecycle: "published" }, skipThrowError: true });
  if (!product) {
    throw new NotFoundError("Product not found");
  }

  const customerProductKey = buildWishlistKey(customerId, productId);

  // Check if already exists
  const existing = await wishlistRepository.findOne({ where: { customerProductKey }, skipThrowError: true });
  if (existing) {
    return {
      _id: existing._id.toString(),
      productId: existing.productId.toString(),
      addedAt: (existing as any).createdAt,
      alreadyExisted: true,
    };
  }

  // Create new entry (duplicate key error caught below)
  try {
    const item = await wishlistRepository.save({
      customerId,
      productId,
      customerProductKey,
    });

    return {
      _id: item._id.toString(),
      productId: item.productId.toString(),
      addedAt: (item as any).createdAt ?? new Date(),
      alreadyExisted: false,
    };
  } catch (error) {
    // Duplicate key error — concurrent insert won the race
    if (error instanceof DuplicateKeyError) {
      const existing = await wishlistRepository.findOne({ where: { customerProductKey }, skipThrowError: true });
      if (existing) {
        return {
          _id: existing._id.toString(),
          productId: existing.productId.toString(),
          addedAt: (existing as any).createdAt,
          alreadyExisted: true,
        };
      }
    }
    throw error;
  }
}
