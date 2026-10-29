import { SortOrder, type PaginatedResponse } from "@kira-joo/toolkit-common";
import { inventorySettingsRepository, variantRepository } from "../../core/repositories";
import { atOrBelowThresholdFilter, classifyStockHealth, type StockHealth } from "../../engines/reports/stock-health";
import { toInventoryItemViews, type InventoryListItemView } from "../inventory/inventory-item-view";
import { getSingletonSettings } from "../settings/singleton-settings";
import type { StockHealthQueryDto } from "../dto/stock-health-query.dto";

export interface StockHealthItemView extends InventoryListItemView {
  health: Exclude<StockHealth, "HEALTHY">;
  effectiveThreshold: number;
}

export interface StockHealthReport extends PaginatedResponse<StockHealthItemView> {
  defaultThreshold: number;
  outOfStockCount: number;
  lowStockCount: number;
}

/**
 * MDS §15a stock health: every variant out of stock or running low, at
 * size-and-colour level, most urgent (lowest stock) first.
 *
 * Discontinued variants are excluded — they will not be reordered, so they
 * are not a reordering signal. The counts cover the whole store; the rows
 * are the requested page.
 */
export async function getStockHealth(query: StockHealthQueryDto): Promise<StockHealthReport> {
  const { lowStockThreshold: defaultThreshold } = await getSingletonSettings(inventorySettingsRepository);
  const active = { discontinued: false };

  const outOfStockCount = await variantRepository.count({ where: { ...active, stock: { $lte: 0 } } });
  const atOrBelowCount = await variantRepository.count({ where: { ...active, ...atOrBelowThresholdFilter(defaultThreshold) } });

  const page = await variantRepository.findAllAndCountPublic({
    where: { ...active, ...atOrBelowThresholdFilter(defaultThreshold) },
    sort: { field: "stock", order: SortOrder.ASC },
    query,
  });

  const rows = await toInventoryItemViews(page.data);

  return {
    ...page,
    defaultThreshold,
    outOfStockCount,
    lowStockCount: atOrBelowCount - outOfStockCount,
    data: rows.map((row) => {
      const effectiveThreshold = row.lowStockThreshold ?? defaultThreshold;
      return { ...row, effectiveThreshold, health: classifyStockHealth(row.stock, effectiveThreshold) as StockHealthItemView["health"] };
    }),
  };
}
