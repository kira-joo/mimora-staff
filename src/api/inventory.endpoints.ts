import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";

/*
 * Wire types for /api/admin/inventory — mirrors InventoryListItemView and the
 * adjust DTOs on the server (`src/server/admin/inventory`, `…/dto`).
 */
export type BackorderPolicy = "DENY" | "CONTINUE_SELLING";

/** The only reasons a direct adjustment may carry; RETURN and SALE are written by their own flows. */
export type AdjustReason = "ADJUSTMENT" | "RECEIPT" | "DAMAGE";

export interface InventoryItem {
  _id: string;
  sku: string;
  optionValues: Array<{ key: string; value: string }>;
  stock: number;
  /** Per-variant override. Absent means the store-wide default applies — and that default is not in this response. */
  lowStockThreshold?: number;
  backorderPolicy: BackorderPolicy;
  discontinued: boolean;
  productId: string;
  productName: { ar: string; en: string };
  productSlug: string;
}

export interface ListInventoryQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  productId?: string;
  categoryId?: string;
  lowStock?: boolean;
  outOfStock?: boolean;
  /** Satisfies `Endpoint`'s `Record<string, unknown>` query constraint while keeping the named fields above. */
  [key: string]: unknown;
}

export interface AdjustStockBody {
  /** Non-zero integer: positive adds, negative removes. */
  delta: number;
  reason: AdjustReason;
  /** 1–500 characters when present. */
  note?: string;
}

export interface BulkAdjustItem extends AdjustStockBody {
  variantId: string;
}

const INVENTORY = "/admin/inventory";

export const listInventoryEndpoint: Endpoint<{ query: ListInventoryQuery; returnType: PaginatedResponse<InventoryItem> }> = {
  url: INVENTORY,
  methodType: MethodType.GET,
};

export const adjustStockEndpoint: Endpoint<{ params: { id: string }; body: AdjustStockBody; returnType: unknown }> = {
  url: `${INVENTORY}/:id/adjust`,
  methodType: MethodType.PUT,
};

/** At most 100 items per request (server cap). */
export const bulkAdjustStockEndpoint: Endpoint<{ body: { items: BulkAdjustItem[] }; returnType: unknown }> = {
  url: `${INVENTORY}/bulk-adjust`,
  methodType: MethodType.PUT,
};

/** The reasons a stock movement can carry. `SALE` and `RETURN` come from orders; the other three from staff adjustments. */
export type MovementReason = "SALE" | "RETURN" | "ADJUSTMENT" | "RECEIPT" | "DAMAGE";

/** One row of the Adjustments log — mirrors `StockMovementView` (`src/server/admin/inventory/list-movements.ts`). */
export interface StockMovement {
  _id: string;
  variantId: string;
  sku: string;
  productName: { ar: string; en: string };
  /** Signed: positive added stock, negative removed it. */
  delta: number;
  reason: MovementReason;
  orderId?: string;
  orderNumber?: string;
  /** Absent for a guest's sale. */
  actor?: { _id: string; kind: "STAFF" | "CUSTOMER"; name?: string };
  note?: string;
  at: string;
}

export interface ListMovementsQuery {
  page?: number;
  limit?: number;
  variantId?: string;
  productId?: string;
  reason?: MovementReason;
  [key: string]: unknown;
}

export const listMovementsEndpoint: Endpoint<{ query: ListMovementsQuery; returnType: PaginatedResponse<StockMovement> }> = {
  url: `${INVENTORY}/movements`,
  methodType: MethodType.GET,
};
