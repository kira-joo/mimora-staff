import type { OrderLineSchema, OrderSchema } from "../../commerce/order.schema";

/**
 * The packing slip: what goes in the box, and where the box goes — and nothing about money.
 *
 * A packing slip travels with the parcel, and the person reading it is a packer or a courier, sometimes not the
 * person who ordered (a gift sent to a recipient). So it carries NO price, discount, tax, total or payment amount.
 * It does carry the payment METHOD, because a courier carrying a cash-on-delivery parcel must know to collect — and
 * the method says so without a figure.
 *
 * Built from the order's own snapshots, like the invoice: a renamed product never changes a slip reprinted later.
 */
export interface PackingSlipView {
  orderNumber: string;
  placedAt: Date;
  status: OrderSchema["status"];
  mode: "DELIVERY" | "PICKUP";
  /** `DELIVERY`: who and where. */
  shipTo?: { recipientName: string; phone: string; addressLine1: string; addressLine2?: string; city: string; governorate: string; postalCode?: string; zone?: string };
  /** `PICKUP`: where the customer will collect, and who is collecting. */
  pickup?: { name: string; address: string; phone: string };
  /** Who to call about the order — guest contact, else the delivery recipient. */
  contact: { name?: string; phone?: string };
  dispatchBy?: Date;
  promisedWindow?: { from: Date; to: Date };
  paymentMethod: string;
  lines: Array<{ lineNumber: number; sku: string; productName: string; variantDescription: string; quantity: number }>;
  totalUnits: number;
  /** The customer's checkout note — a packer needs "gift, no price tag" and "leave with the neighbour". */
  notes?: string;
}

export interface PackingSlipSource {
  order: Pick<OrderSchema, "orderNumber" | "placedAt" | "status" | "guestName" | "guestPhone" | "fulfilment" | "payment" | "notes">;
  lines: ReadonlyArray<Pick<OrderLineSchema, "lineNumber" | "sku" | "productName" | "variantDescription" | "quantity">>;
}

export function buildPackingSlip({ order, lines }: PackingSlipSource): PackingSlipView {
  const address = order.fulfilment.addressSnapshot;
  const sorted = [...lines].sort((a, b) => a.lineNumber - b.lineNumber);

  return {
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    status: order.status,
    mode: order.fulfilment.mode,
    ...(order.fulfilment.mode === "DELIVERY" && address ? { shipTo: { ...address, zone: order.fulfilment.zone } } : {}),
    ...(order.fulfilment.mode === "PICKUP" && order.fulfilment.pickupLocationSnapshot ? { pickup: order.fulfilment.pickupLocationSnapshot } : {}),
    contact: { name: order.guestName ?? address?.recipientName, phone: order.guestPhone ?? address?.phone },
    dispatchBy: order.fulfilment.dispatchBy,
    promisedWindow: order.fulfilment.promisedWindow,
    paymentMethod: order.payment.method,
    lines: sorted.map((line) => ({ lineNumber: line.lineNumber, sku: line.sku, productName: line.productName, variantDescription: line.variantDescription, quantity: line.quantity })),
    totalUnits: sorted.reduce((sum, line) => sum + line.quantity, 0),
    ...(order.notes ? { notes: order.notes } : {}),
  };
}
