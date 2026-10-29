import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { productRepository } from "../../core/repositories";
import { assertProductPublishable } from "../../catalog/product-publishable";
import type { ProductSchema } from "../../catalog/product.schema";

/**
 * Moves a product between draft, published and archived. Publishing is
 * refused while the default locale is incomplete (D-11). In a transaction
 * with the same document `updateProduct` writes, so an edit that blanks
 * the Arabic name cannot slip in between the check and the publish.
 */
export async function setProductLifecycle(productId: string, lifecycle: ProductSchema["lifecycle"]): Promise<ProductSchema> {
  return withTransaction(async (tx) => {
    const product = await productRepository.findOne({ where: { _id: productId }, lean: true });
    if (lifecycle === "published") await assertProductPublishable(product);
    return tx.complete(await productRepository.update({ where: { _id: productId } }, { lifecycle }));
  });
}
