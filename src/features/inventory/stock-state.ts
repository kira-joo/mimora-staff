import { classifyStockHealth } from "src/server/engines/reports/stock-health";

export type StockState = "OUT" | "LOW" | "IN_STOCK" | "AVAILABLE";

/**
 * The state shown beside a stock count.
 *
 * Thresholds are the backend's (`classifyStockHealth`), never restated here.
 * The list response carries only a variant's OWN `lowStockThreshold`; the
 * store-wide default is not in it, and the endpoints that expose it need other
 * permissions (Report.read / inventory settings) a stock clerk may not hold.
 * So without an own threshold the effective one is unknown and we do not guess:
 * `stock <= 0` is unambiguous (out, whatever the threshold), anything above
 * zero is reported as plain "Available". The server-side "Low stock" filter
 * does know the default, so low rows stay findable.
 */
export function stockState(stock: number, lowStockThreshold?: number): StockState {
  if (lowStockThreshold === undefined) return stock <= 0 ? "OUT" : "AVAILABLE";
  const health = classifyStockHealth(stock, lowStockThreshold);
  return health === "OUT_OF_STOCK" ? "OUT" : health === "LOW_STOCK" ? "LOW" : "IN_STOCK";
}

/** Display-only arithmetic for the dialog preview; the server is authoritative. */
export function previewStock(current: number, delta: number | null): number | null {
  return delta === null ? null : current + delta;
}

/** Parses the delta field: a non-zero integer, else null. */
export function parseDelta(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value !== 0 ? value : null;
}
