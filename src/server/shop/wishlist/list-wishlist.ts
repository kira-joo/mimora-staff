import { SortOrder } from "@kira-joo/toolkit-common";
import { productRepository, wishlistRepository } from "../../core/repositories";

export interface WishlistItemView {
  _id: string;
  productId: string;
  productSlug: string;
  productName: { en: string; ar: string };
  addedAt: Date;
}

export interface ListWishlistResult {
  items: WishlistItemView[];
  total: number;
}

/**
 * Lists the authenticated customer's wishlist items.
 *
 * Returns only items for this customer. Each item includes basic product
 * details (slug, name) so the client can render without a separate lookup.
 *
 * Items are sorted by creation date descending (most recently added first).
 */
export async function listWishlist(
  customerId: string,
  options: { limit: number; skip: number }
): Promise<ListWishlistResult> {
  const [items, total] = await Promise.all([
    wishlistRepository.findAll({
      where: { customerId },
      sort: { field: "createdAt", order: SortOrder.DESC },
      take: options.limit,
      skip: options.skip,
    }),
    wishlistRepository.count({ where: { customerId } }),
  ]);

  // Fetch product details for all items
  const productIds = items.map((item) => item.productId);
  const products = await productRepository.findByIds(productIds.map((id) => id.toString()));
  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  return {
    items: items
      .map((item) => {
        const product = productMap.get(item.productId.toString());
        if (!product) return null; // Product deleted

        return {
          _id: item._id.toString(),
          productId: item.productId.toString(),
          productSlug: product.slug,
          productName: product.name,
          addedAt: (item as any).createdAt,
        };
      })
      .filter((item): item is WishlistItemView => item !== null),
    total,
  };
}
