import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { inventorySettingsRepository, productRepository, variantRepository } from "../../core/repositories";
import { getSingletonSettings } from "../settings/singleton-settings";
import type { VariantSchema } from "../../catalog/variant.schema";
import type { ListAdminInventoryQueryDto } from "../dto/list-admin-inventory-query.dto";
import { toInventoryItemViews, type InventoryListItemView } from "./inventory-item-view";

/** Stock levels per variant per MDS §14, filterable by product, category, low-stock, out-of-stock. */
export async function listInventory(query: ListAdminInventoryQueryDto): Promise<PaginatedResponse<InventoryListItemView>> {
  const { productId, categoryId, lowStock, outOfStock, ...rest } = query;
  const where: Record<string, unknown> = {};

  if (productId) {
    where.productId = productId;
  } else if (categoryId) {
    // Variant has no categoryId of its own — resolve through Product first.
    const productsInCategory = await productRepository.findAll({ where: { categoryId } });
    where.productId = { $in: productsInCategory.map((p) => p._id) };
  }

  if (outOfStock) {
    where.stock = 0;
    where.backorderPolicy = "DENY";
  } else if (lowStock) {
    const { lowStockThreshold: defaultThreshold } = await getSingletonSettings(inventorySettingsRepository);
    where.$expr = { $lte: ["$stock", { $ifNull: ["$lowStockThreshold", defaultThreshold] }] };
  }

  const result: PaginatedResponse<VariantSchema> = await variantRepository.findAllAndCountPublic({ where, query: rest });

  return { ...result, data: await toInventoryItemViews(result.data) };
}
