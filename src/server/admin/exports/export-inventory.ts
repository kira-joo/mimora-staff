import { SortOrder } from "@kira-joo/toolkit-common";
import { inventorySettingsRepository, productRepository, variantRepository } from "../../core/repositories";
import { getSingletonSettings } from "../settings/singleton-settings";
import type { ListAdminInventoryQueryDto } from "../dto/list-admin-inventory-query.dto";
import { toInventoryItemViews } from "../inventory/inventory-item-view";
import { EXPORT_PAGE_SIZE } from "./export-customers";
import { numberCell, type CsvExport } from "./csv";

export const INVENTORY_EXPORT_HEADER = ["SKU", "Product (English)", "Product (Arabic)", "Options", "Stock", "Low-stock threshold", "Backorder policy", "Discontinued", "Variant ID", "Product ID"] as const;

/** The inventory list's filters, as `listInventory` applies them — pinned to it by `exports.integration.test.ts`. */
async function buildInventoryFilter(query: ListAdminInventoryQueryDto): Promise<Record<string, unknown>> {
  const { productId, categoryId, lowStock, outOfStock } = query;
  const where: Record<string, unknown> = {};
  if (productId) {
    where.productId = productId;
  } else if (categoryId) {
    const productsInCategory = await productRepository.findAll({ where: { categoryId } });
    where.productId = { $in: productsInCategory.map((product) => product._id) };
  }
  if (outOfStock) {
    where.stock = 0;
    where.backorderPolicy = "DENY";
  } else if (lowStock) {
    const { lowStockThreshold: defaultThreshold } = await getSingletonSettings(inventorySettingsRepository);
    where.$expr = { $lte: ["$stock", { $ifNull: ["$lowStockThreshold", defaultThreshold] }] };
  }
  return where;
}

export async function exportInventory(query: ListAdminInventoryQueryDto): Promise<CsvExport> {
  const filter = await buildInventoryFilter(query);
  return {
    filename: "inventory",
    header: INVENTORY_EXPORT_HEADER,
    rows: (async function* () {
      let after: unknown;
      for (;;) {
        const variants = await variantRepository.findAll({
          where: after ? { ...filter, _id: { $gt: after } } : filter,
          sort: { field: "_id", order: SortOrder.ASC },
          take: EXPORT_PAGE_SIZE,
        });
        for (const item of await toInventoryItemViews(variants)) {
          yield [
            item.sku,
            item.productName.en,
            item.productName.ar,
            item.optionValues.map((option) => `${option.key}: ${option.value}`).join("; "),
            numberCell(item.stock),
            item.lowStockThreshold === undefined ? undefined : numberCell(item.lowStockThreshold),
            item.backorderPolicy,
            item.discontinued,
            item._id,
            item.productId,
          ] as const;
        }
        if (variants.length < EXPORT_PAGE_SIZE) return;
        after = variants[variants.length - 1]!._id;
      }
    })(),
  };
}
