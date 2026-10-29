import { describe, expect, it } from "vitest";
import { buildPickingList, type PickingListOrder } from "./picking-list";

const order = (orderNumber: string, lines: Array<[string, number, string?]>, extra: { status?: PickingListOrder["order"]["status"]; mode?: "DELIVERY" | "PICKUP" } = {}): PickingListOrder => ({
  order: { orderNumber, status: extra.status ?? "CONFIRMED", fulfilment: { mode: extra.mode ?? "DELIVERY", fee: undefined as never } },
  lines: lines.map(([sku, quantity, name]) => ({ sku, quantity, productName: name ?? `Product ${sku}`, variantDescription: "Default" })),
});

describe("buildPickingList", () => {
  it("aggregates one entry per SKU with the total quantity and the orders it serves", () => {
    const list = buildPickingList([order("ORD-000001", [["SKU-A", 2], ["SKU-B", 1]]), order("ORD-000002", [["SKU-A", 3]])]);
    expect(list.items).toEqual([
      { sku: "SKU-A", productName: "Product SKU-A", variantDescription: "Default", quantity: 5, orders: [{ orderNumber: "ORD-000001", quantity: 2 }, { orderNumber: "ORD-000002", quantity: 3 }] },
      { sku: "SKU-B", productName: "Product SKU-B", variantDescription: "Default", quantity: 1, orders: [{ orderNumber: "ORD-000001", quantity: 1 }] },
    ]);
    expect(list.totalUnits).toBe(6);
    expect(list.orderCount).toBe(2);
  });

  it("merges the same SKU on two lines of one order into one entry for that order", () => {
    const list = buildPickingList([order("ORD-000001", [["SKU-A", 1], ["SKU-A", 2]])]);
    expect(list.items[0]!.orders).toEqual([{ orderNumber: "ORD-000001", quantity: 3 }]);
    expect(list.items[0]!.quantity).toBe(3);
  });

  it("orders items by SKU naturally (SKU-2 before SKU-10) whatever order the orders arrive in", () => {
    const list = buildPickingList([order("ORD-000002", [["SKU-10", 1]]), order("ORD-000001", [["SKU-2", 1], ["SKU-1", 1]])]);
    expect(list.items.map((item) => item.sku)).toEqual(["SKU-1", "SKU-2", "SKU-10"]);
  });

  it("is deterministic about the description a SKU shows: the lowest order number's snapshot", () => {
    const a = buildPickingList([order("ORD-000002", [["S", 1, "Renamed"]]), order("ORD-000001", [["S", 1, "Original"]])]);
    const b = buildPickingList([order("ORD-000001", [["S", 1, "Original"]]), order("ORD-000002", [["S", 1, "Renamed"]])]);
    expect(a.items[0]!.productName).toBe("Original");
    expect(b).toEqual(a);
  });

  it("leaves a cancelled order off the list and says so — its stock has already been returned", () => {
    const list = buildPickingList([order("ORD-000001", [["SKU-A", 2]]), order("ORD-000002", [["SKU-A", 5]], { status: "CANCELLED" })]);
    expect(list.items[0]!.quantity).toBe(2);
    expect(list.orderCount).toBe(1);
    expect(list.skipped).toEqual([{ orderNumber: "ORD-000002", reason: "CANCELLED" }]);
  });

  it("lists each included order with its mode and unit count", () => {
    const list = buildPickingList([order("ORD-000001", [["A", 2], ["B", 1]], { mode: "PICKUP" })]);
    expect(list.orders).toEqual([{ orderNumber: "ORD-000001", mode: "PICKUP", units: 3 }]);
  });

  it("is empty, not an error, for nothing selected", () => {
    expect(buildPickingList([])).toEqual({ orderCount: 0, totalUnits: 0, items: [], orders: [], skipped: [] });
  });
});
