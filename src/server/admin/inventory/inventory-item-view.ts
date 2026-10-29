import type { LocalizedString } from "@kira-joo/toolkit-common";
import { productRepository } from "../../core/repositories";
import type { VariantSchema } from "../../catalog/variant.schema";

export interface InventoryListItemView {
  _id: string;
  sku: string;
  optionValues: Array<{ key: string; value: string }>;
  stock: number;
  lowStockThreshold?: number;
  backorderPolicy: "DENY" | "CONTINUE_SELLING";
  discontinued: boolean;
  productId: string;
  productName: LocalizedString;
  productSlug: string;
}

/** One row per variant with its parent product's name and slug — shared by the inventory list and the stock health report. */
export async function toInventoryItemViews(variants: VariantSchema[]): Promise<InventoryListItemView[]> {
  const productIds = [...new Set(variants.map((v) => v.productId.toString()))];
  const products = await productRepository.findAll({ where: { _id: { $in: productIds } } });
  const productById = new Map(products.map((p) => [p._id.toString(), p]));

  return variants.map((variant) => {
    const product = productById.get(variant.productId.toString());
    return {
      _id: variant._id.toString(),
      sku: variant.sku,
      optionValues: variant.optionValues,
      stock: variant.stock,
      lowStockThreshold: variant.lowStockThreshold,
      backorderPolicy: variant.backorderPolicy,
      discontinued: variant.discontinued,
      productId: variant.productId.toString(),
      productName: product?.name ?? { ar: "", en: "" },
      productSlug: product?.slug ?? "",
    };
  });
}
