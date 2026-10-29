/** Mirrors `ProductSchema.lifecycle` exactly (`catalog/product.schema.ts`). */
export type ProductLifecycle = "draft" | "published" | "archived";

/** Mirrors `VariantSchema.backorderPolicy` exactly (`catalog/variant.schema.ts`). */
export type BackorderPolicy = "DENY" | "CONTINUE_SELLING";

export type PurchasabilityRejection = "NOT_PUBLISHED" | "DISCONTINUED" | "INSUFFICIENT_STOCK";

export interface PurchasabilityInput {
  productLifecycle: ProductLifecycle;
  discontinued: boolean;
  stock: number;
  backorderPolicy: BackorderPolicy;
  /** Defaults to 1 — the common case of checking whether a single unit can be added. */
  requestedQuantity?: number;
}

export type PurchasabilityResult =
  | { purchasable: true }
  | { purchasable: false; reason: PurchasabilityRejection };
