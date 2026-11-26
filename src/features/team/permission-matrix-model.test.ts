import { describe, expect, it } from "vitest";
import { buildMatrix, cellState, rowKeys, toggleKeys, type MatrixPermission } from "./permission-matrix-model";

const p = (key: string, name = key): MatrixPermission => {
  const [entity, action] = key.split(".") as [string, string];
  return { key, entity, action, name };
};

describe("permission matrix model", () => {
  const permissions = [
    p("Product.read"),
    p("Product.readOne"),
    p("Product.create"),
    p("Product.update"),
    p("Product.delete"),
    p("Order.read"),
    p("Order.export", "Export Orders (CSV)"),
    p("Order.transition", "Transition Order Status"),
    p("Mystery.read"),
  ];
  const sections = buildMatrix(permissions);

  it("places modules in the navigation's sections and keeps unplaced entities under Other", () => {
    expect(sections.map((section) => section.label)).toEqual(["Operations", "Catalog", "Other"]);
    expect(sections.at(-1)!.rows.map((row) => row.label)).toEqual(["Mystery"]);
  });

  it("maps CRUD actions to columns (View carries list and one) and keeps the rest as named special actions", () => {
    const product = sections.find((section) => section.label === "Catalog")!.rows[0]!;
    expect(product.columns).toEqual({ view: ["Product.read", "Product.readOne"], create: ["Product.create"], update: ["Product.update"], delete: ["Product.delete"] });
    const order = sections[0]!.rows[0]!;
    expect(order.columns.create).toEqual([]);
    expect(order.special).toEqual([
      { key: "Order.export", label: "Export Orders (CSV)" },
      { key: "Order.transition", label: "Transition Order Status" },
    ]);
    expect(rowKeys(order).sort()).toEqual(["Order.export", "Order.read", "Order.transition"]);
  });

  it("reports partial cells and toggles every key behind a cell", () => {
    const view = ["Product.read", "Product.readOne"];
    expect(cellState(view, new Set())).toBe("off");
    expect(cellState(view, new Set(["Product.read"]))).toBe("partial");
    expect(cellState(view, new Set(view))).toBe("on");
    const on = toggleKeys(new Set(["Order.read"]), view, true);
    expect([...on].sort()).toEqual(["Order.read", "Product.read", "Product.readOne"]);
    expect([...toggleKeys(on, view, false)]).toEqual(["Order.read"]);
  });

  it("drops a module with nothing assignable", () => {
    expect(buildMatrix([])).toEqual([]);
  });
});
