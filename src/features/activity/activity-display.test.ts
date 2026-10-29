import { describe, expect, it } from "vitest";
import { ACTION_OPTIONS, ENTITY_OPTIONS, changeLines, humanize, recordLink } from "./activity-display";

describe("recordLink", () => {
  it("opens the record a log entry is about", () => {
    expect(recordLink("Product", "p1")).toEqual({ href: "/catalog/products/p1", noun: "product" });
    expect(recordLink("DeliveryZone", "z1")?.href).toBe("/fulfilment/delivery-zones/z1");
  });

  it("opens every payment decision, refunds included, on its order", () => {
    expect(recordLink("Payment", "o1")).toEqual({ href: "/orders/o1", noun: "order" });
    expect(recordLink("Payment", "o1")?.href).toBe("/orders/o1");
    expect(recordLink("Payment", "o1")?.href).toBe("/orders/o1");
  });

  it("opens a return refund on its return", () => {
    expect(recordLink("Return", "r1")).toEqual({ href: "/returns/r1", noun: "return" });
  });

  it("has no link for an entity without a screen, or without an id", () => {
    expect(recordLink("Variant", "v1")).toBeUndefined();
    expect(recordLink("Product", undefined)).toBeUndefined();
  });
});

describe("humanize", () => {
  it.each([
    ["DeliveryZone", "Delivery zone"],
    ["StaffUser", "Staff user"],
    ["verify", "Verify"],
    ["payment_settings", "Payment settings"],
  ])("%s → %s", (input, output) => expect(humanize(input)).toBe(output));
});

describe("filter options", () => {
  it("lists entities and write actions from the permission registry, without duplicates", () => {
    const entities = ENTITY_OPTIONS.map((option) => option.value);
    expect(entities).toEqual(expect.arrayContaining(["Product", "Payment", "Inventory"]));
    expect(new Set(entities).size).toBe(entities.length);
    const actions = ACTION_OPTIONS.map((option) => option.value);
    expect(actions).toEqual(expect.arrayContaining(["create", "update", "verify", "adjust"]));
    expect(actions).not.toContain("read");
    expect(actions).not.toContain("readOne");
  });
});

describe("changeLines", () => {
  it("flattens nested objects into dotted paths and keeps Arabic as sent", () => {
    expect(changeLines({ name: { en: "Shirts", ar: "قمصان" }, published: true })).toEqual([
      { path: "name.en", value: "Shirts" },
      { path: "name.ar", value: "قمصان" },
      { path: "published", value: "true" },
    ]);
  });

  it("joins scalar arrays and shows object arrays and deep values as JSON", () => {
    expect(changeLines({ areas: ["Maadi", "Zamalek"], empty: [], items: [{ id: 1 }] })).toEqual([
      { path: "areas", value: "Maadi, Zamalek" },
      { path: "empty", value: "(none)" },
      { path: "items", value: '[{"id":1}]' },
    ]);
    expect(changeLines({ a: { b: { c: { d: 1 } } } })).toEqual([{ path: "a.b.c", value: '{"d":1}' }]);
  });

  it("shows redacted and missing values as they came", () => {
    expect(changeLines({ password: "[redacted]", note: null })).toEqual([
      { path: "password", value: "[redacted]" },
      { path: "note", value: "—" },
    ]);
    expect(changeLines(undefined)).toEqual([]);
  });
});
