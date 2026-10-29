import { describe, expect, it } from "vitest";
import { exportUrl, filenameFrom } from "./export-url";

describe("exportUrl", () => {
  it("forwards the table's filters and search but never its paging or sorting", () => {
    expect(exportUrl("orders", "status=CANCELLED&mode=DELIVERY&page=4&limit=25&sortBy=total&sortOrder=DESC")).toBe("/api/admin/exports/orders?status=CANCELLED&mode=DELIVERY");
    expect(exportUrl("customers", new URLSearchParams("search=%D9%85%D9%86%D9%89&page=2"))).toBe("/api/admin/exports/customers?search=%D9%85%D9%86%D9%89");
  });

  it("with no filter it is the bare path, and empty values are dropped", () => {
    expect(exportUrl("inventory", "")).toBe("/api/admin/exports/inventory");
    expect(exportUrl("inventory", "lowStock=&productId=")).toBe("/api/admin/exports/inventory");
  });
});

describe("filenameFrom", () => {
  it("reads the suggested name, with a fallback", () => {
    expect(filenameFrom('attachment; filename="orders-2026-10-24.csv"', "x.csv")).toBe("orders-2026-10-24.csv");
    expect(filenameFrom(null, "orders.csv")).toBe("orders.csv");
  });
});
