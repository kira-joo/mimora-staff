import { NotFoundError, ValidationFailedError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import type { Money } from "@kira-joo/toolkit-common";
import { productRepository, variantRepository } from "../../core/repositories";
import type { VariantSchema } from "../../catalog/variant.schema";
import { maintainProductListingRollup } from "../../catalog/rollups/maintain-product-listing";
import { rowProblemsToError } from "./bulk-create-variants";

export interface BulkUpdateVariantRow {
  id: string;
  price?: Money;
  /** `null` clears it; `undefined` leaves it. */
  compareAtPrice?: Money | null;
  costPrice?: Money | null;
  discontinued?: boolean;
}

/**
 * Applies the inline edits of a product's matrix grid — price, compare-at, cost, on/off sale — in ONE
 * transaction. Stock is not here by design: it moves only through inventory adjustments, which write the movement.
 *
 * Every row must name a variant of THIS product (a stale grid or a forged id is a per-row error, and a variant of
 * another product is never touched). The listing rollup is recomputed once, after all rows, inside the same
 * transaction — price and on/off sale both feed it, and the storefront's "from" price must never disagree with
 * the variants.
 */
export async function bulkUpdateVariants(input: { productId: string; rows: readonly BulkUpdateVariantRow[] }): Promise<VariantSchema[]> {
  const product = await productRepository.findOne({ where: { _id: input.productId }, skipThrowError: true });
  if (!product) throw new NotFoundError("Product not found");

  const ids = input.rows.map((row) => row.id);
  const found = await variantRepository.findAll({ where: { _id: { $in: ids }, productId: product._id } });
  const known = new Set(found.map((variant) => variant._id.toString()));
  const problems = input.rows.flatMap((row, index) => (known.has(row.id) ? [] : [{ index, field: "id", message: "This variant does not belong to the product." }]));
  const repeated = ids.flatMap((id, index) => (ids.indexOf(id) === index ? [] : [{ index, field: "id", message: `This variant is edited twice (see row ${ids.indexOf(id) + 1}).` }]));
  if (problems.length + repeated.length > 0) throw rowProblemsToError([...problems, ...repeated]);

  return withTransaction(async (tx) => {
    const updated: VariantSchema[] = [];
    for (const row of input.rows) {
      const set: Record<string, unknown> = {};
      const unset: Record<string, ""> = {};
      if (row.price !== undefined) set.price = row.price;
      if (row.compareAtPrice !== undefined) {
        if (row.compareAtPrice === null) unset.compareAtPrice = "";
        else set.compareAtPrice = row.compareAtPrice;
      }
      if (row.costPrice !== undefined) {
        if (row.costPrice === null) unset.costPrice = "";
        else set.costPrice = row.costPrice;
      }
      if (row.discontinued !== undefined) set.discontinued = row.discontinued;

      updated.push(await variantRepository.updateAtomic({ _id: row.id }, { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) }));
    }
    await maintainProductListingRollup(product._id);
    return tx.complete(updated);
  });
}
