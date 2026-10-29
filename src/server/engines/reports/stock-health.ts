export type StockHealth = "OUT_OF_STOCK" | "LOW_STOCK" | "HEALTHY";

/**
 * Classifies one variant's on-hand stock — MDS §15a's stock health report
 * works at size-and-colour level because "in apparel the size runs out, not
 * the product."
 *
 * This is physical stock, the reordering question, not purchasability: a
 * variant selling on backorder (`CONTINUE_SELLING`) at zero or below is still
 * out of stock and still needs reordering, so `backorderPolicy` does not move
 * it out of this bucket — the report carries the policy alongside instead.
 *
 * `threshold` is the effective one: the variant's own override, else the
 * store-wide `InventorySettings.lowStockThreshold`.
 */
export function classifyStockHealth(stock: number, threshold: number): StockHealth {
  if (stock <= 0) return "OUT_OF_STOCK";
  if (stock <= threshold) return "LOW_STOCK";
  return "HEALTHY";
}

/**
 * The Mongo filter matching every variant {@link classifyStockHealth} would
 * not call `HEALTHY` — kept beside it so the query and the classification
 * cannot disagree about where "low" ends.
 */
export function atOrBelowThresholdFilter(defaultThreshold: number) {
  return {
    $or: [{ stock: { $lte: 0 } }, { $expr: { $lte: ["$stock", { $ifNull: ["$lowStockThreshold", defaultThreshold] }] } }],
  };
}
