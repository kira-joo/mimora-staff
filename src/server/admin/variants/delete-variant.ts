import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { variantRepository } from "../../core/repositories";
import { maintainProductListingRollup } from "../../catalog/rollups/maintain-product-listing";

/**
 * Hard delete. Unlike Product, a Variant carries no independent lifecycle —
 * `discontinued` (via `updateVariant`) is the reversible off-switch; this
 * removes the row entirely, for a variant created by mistake. Order lines
 * already snapshot everything they need (constitution's "orders snapshot
 * what was purchased"), so a past order is unaffected by this delete.
 */
export async function deleteVariant(variantId: string): Promise<void> {
  return withTransaction(async (tx) => {
    const variant = await variantRepository.delete({ where: { _id: variantId } });
    await maintainProductListingRollup(variant.productId);

    return tx.complete(undefined);
  });
}
