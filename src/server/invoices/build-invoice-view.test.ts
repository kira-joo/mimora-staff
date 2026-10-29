import { toMoney } from "@kira-joo/toolkit-common";
import { describe, expect, it } from "vitest";
import { buildInvoiceView, type InvoiceSource } from "./build-invoice-view";

const placedAt = new Date("2026-03-01T10:00:00Z");

function source(overrides: Partial<InvoiceSource["order"]> = {}): InvoiceSource {
  return {
    order: {
      orderNumber: "ORD-000007",
      invoiceNumber: "INV-000003",
      invoiceSnapshot: { issuedAt: placedAt, seller: { name: { en: "Acme Store", ar: "متجر أكمي" }, phone: "+20100", email: "hi@acme.example" }, tax: { mode: "ADDED", rate: 14 } },
      placedAt,
      status: "PLACED",
      guestName: "Mona Adel",
      guestPhone: "+201000000001",
      guestEmail: undefined,
      fulfilment: {
        mode: "DELIVERY",
        zone: "Cairo",
        fee: toMoney("30.00"),
        addressSnapshot: { recipientName: "Mona Adel", phone: "+201000000001", addressLine1: "1 Nile St", city: "Cairo", governorate: "Cairo" },
      },
      subtotal: toMoney("200.00"),
      discount: toMoney("20.00"),
      tax: toMoney("25.20"),
      total: toMoney("235.20"),
      refundedTotal: toMoney("0.00"),
      payment: { method: "COD", status: "NOT_REQUIRED" },
      timeline: [{ type: "ORDER_PLACED", at: placedAt, actorType: "CUSTOMER" }],
      ...overrides,
    },
    lines: [
      { lineNumber: 2, sku: "SKU-B", productName: "Boots", variantDescription: "Brown / 42", quantity: 1, unitPrice: toMoney("120.00"), lineTotal: toMoney("120.00"), lineDiscount: toMoney("0.00"), promotionCode: "SPRING" },
      { lineNumber: 1, sku: "SKU-A", productName: "Shirt", variantDescription: "Olive / M", quantity: 2, unitPrice: toMoney("40.00"), lineTotal: toMoney("80.00"), lineDiscount: toMoney("20.00"), promotionCode: "SPRING" },
    ],
  };
}

describe("buildInvoiceView", () => {
  it("has no invoice for an order placed before invoices existed", () => {
    expect(buildInvoiceView(source({ invoiceNumber: undefined, invoiceSnapshot: undefined }))).toBeUndefined();
  });

  it("carries the numbers, dates, seller and the lines in line order with SKU, quantity, price and discount", () => {
    const view = buildInvoiceView(source())!;
    expect(view).toMatchObject({ invoiceNumber: "INV-000003", orderNumber: "ORD-000007", status: "ISSUED", seller: { name: { en: "Acme Store" }, phone: "+20100" } });
    expect(view.issuedAt).toEqual(placedAt);
    expect(view.lines.map((line) => line.sku)).toEqual(["SKU-A", "SKU-B"]);
    expect(view.lines[0]).toMatchObject({ quantity: 2, productName: "Shirt", variantDescription: "Olive / M" });
    expect(view.lines[0]!.unitPrice.toFixed(2)).toBe("40.00");
    expect(view.lines[0]!.discount.toFixed(2)).toBe("20.00");
    expect(view.promotionCode).toBe("SPRING");
  });

  it("states subtotal, discount, shipping, tax with its mode, and total — as the order froze them", () => {
    const view = buildInvoiceView(source())!;
    expect([view.subtotal, view.discount, view.shipping, view.tax.amount, view.total].map((amount) => amount.toFixed(2))).toEqual(["200.00", "20.00", "30.00", "25.20", "235.20"]);
    expect(view.tax).toMatchObject({ mode: "ADDED", rate: 14 });
  });

  it("reports tax as included when that was the mode at placement, whatever the store uses now", () => {
    const view = buildInvoiceView(source({ invoiceSnapshot: { issuedAt: placedAt, tax: { mode: "INCLUDED", rate: 14 } } }))!;
    expect(view.tax.mode).toBe("INCLUDED");
    expect(view.seller).toBeUndefined();
  });

  it("shows the payment method and status", () => {
    expect(buildInvoiceView(source({ payment: { method: "WALLET_TRANSFER", status: "VERIFIED" } }))!.payment).toEqual({ method: "WALLET_TRANSFER", status: "VERIFIED" });
  });

  describe("void", () => {
    const cancelledAt = new Date("2026-03-02T09:00:00Z");
    const cancelled = source({
      status: "CANCELLED",
      timeline: [
        { type: "ORDER_PLACED", at: placedAt, actorType: "CUSTOMER" },
        { type: "ORDER_CANCELLED", at: cancelledAt, actorType: "STAFF", reason: "internal: fraud suspected" },
      ],
    });

    it("keeps its number and prints VOID, with when", () => {
      const view = buildInvoiceView(cancelled)!;
      expect(view.invoiceNumber).toBe("INV-000003");
      expect(view.status).toBe("VOID");
      expect(view.voidedAt).toEqual(cancelledAt);
    });

    it("never carries the staff's cancellation reason", () => {
      expect(JSON.stringify(buildInvoiceView(cancelled))).not.toContain("fraud");
    });
  });

  describe("refunds", () => {
    it("lists the payment refund and each refunded return, oldest first, with the total refunded", () => {
      const view = buildInvoiceView({
        ...source({ refundedTotal: toMoney("70.00"), payment: { method: "WALLET_TRANSFER", status: "REFUNDED", refund: { amount: toMoney("30.00"), at: new Date("2026-03-05T00:00:00Z"), reference: "TXN-1" } } }),
        returnRefunds: [{ returnNumber: "RET-000001", amount: toMoney("40.00"), at: new Date("2026-03-03T00:00:00Z"), reference: "TXN-0" }],
      })!;
      expect(view.refunds.total.toFixed(2)).toBe("70.00");
      expect(view.refunds.entries.map((entry) => [entry.kind, entry.amount.toFixed(2), entry.returnNumber ?? null])).toEqual([
        ["RETURN", "40.00", "RET-000001"],
        ["PAYMENT", "30.00", null],
      ]);
    });

    it("is zero and empty when nothing was refunded", () => {
      const view = buildInvoiceView(source())!;
      expect(view.refunds.total.toFixed(2)).toBe("0.00");
      expect(view.refunds.entries).toEqual([]);
    });
  });

  describe("bill-to", () => {
    it("uses the guest contact, else the delivery recipient, else the account", () => {
      expect(buildInvoiceView(source())!.billTo.name).toBe("Mona Adel");
      const noGuest = source({ guestName: undefined, guestPhone: undefined });
      expect(buildInvoiceView(noGuest)!.billTo).toMatchObject({ name: "Mona Adel", phone: "+201000000001" });
      const pickup = source({ guestName: undefined, guestPhone: undefined, fulfilment: { mode: "PICKUP", fee: toMoney("0.00"), pickupLocationSnapshot: { name: "Shop", address: "1 St", phone: "1" } } });
      expect(buildInvoiceView({ ...pickup, accountContact: { name: "Account Holder", phone: "+20111" } })!.billTo).toMatchObject({ name: "Account Holder", phone: "+20111" });
    });
  });
});
