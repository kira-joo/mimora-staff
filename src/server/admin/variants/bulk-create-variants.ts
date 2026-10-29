import { NotFoundError, ValidationFailedError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import type { Money } from "@kira-joo/toolkit-common";
import { productRepository, variantRepository } from "../../core/repositories";
import type { VariantSchema } from "../../catalog/variant.schema";
import { buildVariantKey } from "../../catalog/variant-key";
import { findCreateRowProblems, type RowProblem } from "../../catalog/variant-row-problems";
import { createVariant } from "./create-variant";

export interface BulkCreateVariantRow {
  sku: string;
  optionValues: Array<{ key: string; value: string }>;
  price: Money;
  compareAtPrice?: Money;
  costPrice?: Money;
  stock: number;
}

/** A refusal that names every offending row and field (`rows.3.sku`), so the grid can mark each cell. */
export function rowProblemsToError(problems: readonly RowProblem[]): ValidationFailedError {
  const byField = new Map<string, string[]>();
  for (const problem of problems) {
    const field = `rows.${problem.index}.${problem.field}`;
    byField.set(field, [...(byField.get(field) ?? []), problem.message]);
  }
  return new ValidationFailedError([...byField].map(([field, messages]) => ({ field, messages })));
}

/**
 * Creates the chosen combinations of a product's matrix in ONE transaction: every row, or none.
 *
 * The rows are checked as a whole first (`findCreateRowProblems`) so every problem is reported at once. Each
 * row is then created through `createVariant` itself — the same axis check, SKU and `variantKey` uniqueness,
 * store-default backorder policy and RECEIPT "Opening stock" movement as a single create — inside the outer
 * transaction, which the nested calls join. A failure on any row, including one only a race can cause (another
 * request taking the SKU between the check and the write), aborts everything: no variant, no movement, and the
 * product's listing rollup is what it was.
 */
export async function bulkCreateVariants(input: { productId: string; rows: readonly BulkCreateVariantRow[]; actorId?: string }): Promise<VariantSchema[]> {
  const product = await productRepository.findOne({ where: { _id: input.productId }, skipThrowError: true });
  if (!product) throw new NotFoundError("Product not found");

  const skus = input.rows.map((row) => row.sku.trim());
  const existingBySku = await variantRepository.findAll({ where: { sku: { $in: skus } } });
  const keys = input.rows.map((row) => buildVariantKey(input.productId, row.optionValues));
  const existingByKey = await variantRepository.findAll({ where: { variantKey: { $in: keys } } });

  const problems = findCreateRowProblems(
    input.productId,
    product.optionAxes.map((axis) => axis.key),
    input.rows,
    { skus: new Set(existingBySku.map((variant) => variant.sku)), variantKeys: new Set(existingByKey.map((variant) => variant.variantKey)) }
  );
  if (problems.length > 0) throw rowProblemsToError(problems);

  return withTransaction(async (tx) => {
    const created: VariantSchema[] = [];
    // Sequential: one session cannot run concurrent operations.
    for (const row of input.rows) {
      created.push(
        await createVariant({
          productId: input.productId,
          sku: row.sku.trim(),
          optionValues: row.optionValues,
          price: row.price,
          compareAtPrice: row.compareAtPrice,
          costPrice: row.costPrice,
          stock: row.stock,
          actorId: input.actorId,
        })
      );
    }
    return tx.complete(created);
  });
}
