import type { OrderLineSchema, OrderSchema } from "../../commerce/order.schema";

/**
 * A picking list for a set of orders: walk the shelves ONCE, pick each SKU's total, then split it back into orders.
 *
 * Aggregation is per SKU — the identifier that names a variant uniquely — never per product name, which differs
 * between locales and over time. Each item carries the orders it serves, with the quantity each needs, so the packer
 * can distribute the pick without re-reading the orders.
 *
 * Pure: the caller supplies the orders and their lines.
 */
export interface PickingListItem {
  sku: string;
  productName: string;
  variantDescription: string;
  /** Total units to pick across every order on the list. */
  quantity: number;
  /** The orders this pick serves, by order number, each with its own quantity. */
  orders: Array<{ orderNumber: string; quantity: number }>;
}

export interface PickingListView {
  orderCount: number;
  totalUnits: number;
  items: PickingListItem[];
  orders: Array<{ orderNumber: string; mode: "DELIVERY" | "PICKUP"; units: number }>;
  /** Selected orders left off the list, and why. A cancelled order's stock has been returned — picking it would pull it off the shelf twice. */
  skipped: Array<{ orderNumber: string; reason: "CANCELLED" }>;
}

export interface PickingListOrder {
  order: Pick<OrderSchema, "orderNumber" | "status" | "fulfilment">;
  lines: ReadonlyArray<Pick<OrderLineSchema, "sku" | "productName" | "variantDescription" | "quantity">>;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function buildPickingList(entries: readonly PickingListOrder[]): PickingListView {
  // Oldest-numbered first: the description a SKU carries on the list is then deterministic, whatever order the caller passed.
  const sorted = [...entries].sort((a, b) => collator.compare(a.order.orderNumber, b.order.orderNumber));

  const items = new Map<string, PickingListItem>();
  const orders: PickingListView["orders"] = [];
  const skipped: PickingListView["skipped"] = [];

  for (const { order, lines } of sorted) {
    if (order.status === "CANCELLED") {
      skipped.push({ orderNumber: order.orderNumber, reason: "CANCELLED" });
      continue;
    }

    let units = 0;
    for (const line of lines) {
      units += line.quantity;
      const item = items.get(line.sku) ?? { sku: line.sku, productName: line.productName, variantDescription: line.variantDescription, quantity: 0, orders: [] };
      item.quantity += line.quantity;
      // The same SKU on two lines of one order is one entry for that order.
      const forOrder = item.orders.find((candidate) => candidate.orderNumber === order.orderNumber);
      if (forOrder) forOrder.quantity += line.quantity;
      else item.orders.push({ orderNumber: order.orderNumber, quantity: line.quantity });
      items.set(line.sku, item);
    }
    orders.push({ orderNumber: order.orderNumber, mode: order.fulfilment.mode, units });
  }

  const sortedItems = [...items.values()].sort((a, b) => collator.compare(a.sku, b.sku));
  return { orderCount: orders.length, totalUnits: sortedItems.reduce((sum, item) => sum + item.quantity, 0), items: sortedItems, orders, skipped };
}
