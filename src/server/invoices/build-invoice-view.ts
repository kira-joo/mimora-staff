import type { LocalizedString, Money } from "@kira-joo/toolkit-common";
import { ZERO } from "@kira-joo/toolkit-common";
import type { OrderLineSchema, OrderSchema } from "../commerce/order.schema";

/**
 * The invoice, as one document: everything a printed invoice shows, assembled from the ORDER ALONE.
 *
 * Nothing here reads today's catalog, store profile or settings. Product names, SKUs, prices and the delivery
 * address are the order lines' and fulfilment's own snapshots; the seller and the tax mode are the
 * `invoiceSnapshot` frozen at placement. So an invoice issued in March prints identically in November, after the
 * store has been renamed, repriced and moved to a different tax mode — which is what makes it an invoice.
 *
 * Pure: the caller supplies the order, its lines, and the refunds recorded against its returns (a separate
 * collection). The same view serves the console and the storefront.
 */
export interface InvoiceView {
  invoiceNumber: string;
  orderNumber: string;
  issuedAt: Date;
  placedAt: Date;
  /**
   * `VOID` once the order is cancelled. The invoice keeps its number and keeps printing — a voided invoice is a
   * record that an invoice existed and no longer stands, not a gap in the sequence.
   */
  status: "ISSUED" | "VOID";
  voidedAt?: Date;
  seller?: { name: LocalizedString; phone?: string; email?: string };
  billTo: { name?: string; phone?: string; email?: string };
  fulfilment: {
    mode: "DELIVERY" | "PICKUP";
    zone?: string;
    address?: { recipientName: string; phone: string; addressLine1: string; addressLine2?: string; city: string; governorate: string; postalCode?: string };
    pickupLocation?: { name: string; address: string; phone: string };
  };
  lines: Array<{
    lineNumber: number;
    sku: string;
    productName: string;
    variantDescription: string;
    quantity: number;
    unitPrice: Money;
    discount: Money;
    lineTotal: Money;
  }>;
  subtotal: Money;
  discount: Money;
  promotionCode?: string;
  shipping: Money;
  /** `ADDED`: `amount` is on top of the subtotal. `INCLUDED`: `amount` is already inside the total. */
  tax: { mode: "INCLUDED" | "ADDED"; rate: number; amount: Money };
  total: Money;
  payment: { method: string; status: OrderSchema["payment"]["status"] };
  refunds: {
    total: Money;
    entries: Array<{ kind: "PAYMENT" | "RETURN"; amount: Money; at?: Date; reference?: string; returnNumber?: string }>;
  };
}

export interface InvoiceReturnRefund {
  returnNumber: string;
  amount: Money;
  at?: Date;
  reference?: string;
}

export interface InvoiceSource {
  order: Pick<
    OrderSchema,
    | "orderNumber"
    | "invoiceNumber"
    | "invoiceSnapshot"
    | "placedAt"
    | "status"
    | "guestName"
    | "guestPhone"
    | "guestEmail"
    | "fulfilment"
    | "subtotal"
    | "discount"
    | "tax"
    | "total"
    | "payment"
    | "timeline"
    | "refundedTotal"
  >;
  lines: ReadonlyArray<Pick<OrderLineSchema, "lineNumber" | "sku" | "productName" | "variantDescription" | "quantity" | "unitPrice" | "lineTotal" | "lineDiscount" | "promotionCode">>;
  returnRefunds?: readonly InvoiceReturnRefund[];
  /** Only for a signed-in customer's order that carries no guest contact and no delivery recipient (a pickup). Read-time, never frozen. */
  accountContact?: { name?: string; phone?: string; email?: string };
}

/** `undefined` for an order that has no invoice (placed before invoices existed) — the caller answers 404. */
export function buildInvoiceView(source: InvoiceSource): InvoiceView | undefined {
  const { order, lines } = source;
  if (!order.invoiceNumber || !order.invoiceSnapshot) return undefined;

  const address = order.fulfilment.addressSnapshot;
  const voided = order.status === "CANCELLED";
  const cancelledAt = voided ? [...order.timeline].reverse().find((entry) => entry.type === "ORDER_CANCELLED")?.at : undefined;
  const lineWithCode = lines.find((line) => line.promotionCode);

  const refundEntries: InvoiceView["refunds"]["entries"] = [];
  if (order.payment.refund?.amount) {
    refundEntries.push({ kind: "PAYMENT", amount: order.payment.refund.amount, at: order.payment.refund.at, reference: order.payment.refund.reference });
  }
  for (const refund of source.returnRefunds ?? []) {
    refundEntries.push({ kind: "RETURN", amount: refund.amount, at: refund.at, reference: refund.reference, returnNumber: refund.returnNumber });
  }
  refundEntries.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));

  return {
    invoiceNumber: order.invoiceNumber,
    orderNumber: order.orderNumber,
    issuedAt: order.invoiceSnapshot.issuedAt,
    placedAt: order.placedAt,
    status: voided ? "VOID" : "ISSUED",
    ...(cancelledAt ? { voidedAt: cancelledAt } : {}),
    ...(order.invoiceSnapshot.seller ? { seller: order.invoiceSnapshot.seller } : {}),
    billTo: {
      name: order.guestName ?? address?.recipientName ?? source.accountContact?.name,
      phone: order.guestPhone ?? address?.phone ?? source.accountContact?.phone,
      email: order.guestEmail ?? source.accountContact?.email,
    },
    fulfilment: {
      mode: order.fulfilment.mode,
      zone: order.fulfilment.zone,
      address,
      pickupLocation: order.fulfilment.pickupLocationSnapshot,
    },
    lines: [...lines]
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((line) => ({
        lineNumber: line.lineNumber,
        sku: line.sku,
        productName: line.productName,
        variantDescription: line.variantDescription,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.lineDiscount ?? ZERO,
        lineTotal: line.lineTotal,
      })),
    subtotal: order.subtotal,
    discount: order.discount ?? ZERO,
    ...(lineWithCode?.promotionCode ? { promotionCode: lineWithCode.promotionCode } : {}),
    shipping: order.fulfilment.fee ?? ZERO,
    tax: { mode: order.invoiceSnapshot.tax.mode, rate: order.invoiceSnapshot.tax.rate, amount: order.tax ?? ZERO },
    total: order.total,
    payment: { method: order.payment.method, status: order.payment.status },
    refunds: { total: order.refundedTotal ?? ZERO, entries: refundEntries },
  };
}
