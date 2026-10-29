import { toMoney } from "@kira-joo/toolkit-common";
import { describe, expect, it } from "vitest";
import { buildPackingSlip, type PackingSlipSource } from "./packing-slip";

const delivery: PackingSlipSource = {
  order: {
    orderNumber: "ORD-000042",
    placedAt: new Date("2026-03-01T10:00:00Z"),
    status: "PROCESSING",
    guestName: "Mona Adel",
    guestPhone: "+201000000001",
    notes: "Gift — leave with the neighbour",
    payment: { method: "COD", status: "NOT_REQUIRED" },
    fulfilment: {
      mode: "DELIVERY",
      zone: "Cairo",
      fee: toMoney("30.00"),
      addressSnapshot: { recipientName: "Sara", phone: "+201000000002", addressLine1: "1 Nile St", city: "Cairo", governorate: "Cairo" },
    },
  },
  lines: [
    { lineNumber: 2, sku: "SKU-B", productName: "Boots", variantDescription: "Brown / 42", quantity: 1 },
    { lineNumber: 1, sku: "SKU-A", productName: "Shirt", variantDescription: "Olive / M", quantity: 2 },
  ],
};

describe("buildPackingSlip", () => {
  it("lists the lines in order with SKU, options and quantity, and the unit total", () => {
    const slip = buildPackingSlip(delivery);
    expect(slip.lines).toEqual([
      { lineNumber: 1, sku: "SKU-A", productName: "Shirt", variantDescription: "Olive / M", quantity: 2 },
      { lineNumber: 2, sku: "SKU-B", productName: "Boots", variantDescription: "Brown / 42", quantity: 1 },
    ]);
    expect(slip.totalUnits).toBe(3);
  });

  it("carries ship-to for a delivery, the contact, the notes and the order number", () => {
    const slip = buildPackingSlip(delivery);
    expect(slip.orderNumber).toBe("ORD-000042");
    expect(slip.shipTo).toMatchObject({ recipientName: "Sara", addressLine1: "1 Nile St", zone: "Cairo" });
    expect(slip.pickup).toBeUndefined();
    expect(slip.contact).toEqual({ name: "Mona Adel", phone: "+201000000001" });
    expect(slip.notes).toBe("Gift — leave with the neighbour");
  });

  it("carries the pickup location, not a ship-to, for a pickup order", () => {
    const slip = buildPackingSlip({
      ...delivery,
      order: { ...delivery.order, fulfilment: { mode: "PICKUP", fee: toMoney("0.00"), pickupLocationSnapshot: { name: "Downtown shop", address: "5 Main St", phone: "+2010" } } },
    });
    expect(slip.pickup).toEqual({ name: "Downtown shop", address: "5 Main St", phone: "+2010" });
    expect(slip.shipTo).toBeUndefined();
  });

  it("contains NO money at all — the slip travels with the parcel and may be read by the recipient of a gift", () => {
    const json = JSON.stringify(buildPackingSlip(delivery));
    // Neither the delivery fee (30.00) nor any total, price or discount key appears.
    expect(json).not.toMatch(/30\.00|fee|price|total\b|subtotal|discount|tax|amount/i);
    expect(Object.keys(buildPackingSlip(delivery))).not.toContain("total");
  });

  it("names the payment METHOD (a courier must know to collect cash) but never an amount", () => {
    expect(buildPackingSlip(delivery).paymentMethod).toBe("COD");
  });
});
