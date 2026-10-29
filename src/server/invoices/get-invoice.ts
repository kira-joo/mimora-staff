import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { SortOrder } from "@kira-joo/toolkit-common";
import type { OrderSchema } from "../commerce/order.schema";
import { customerRepository, orderLineRepository, orderRepository, returnRepository } from "../core/repositories";
import { buildInvoiceView, type InvoiceView } from "./build-invoice-view";

/**
 * Loads what `buildInvoiceView` needs for an order already authorised by the caller, and builds the invoice.
 *
 * The caller owns access control — the console route checks `Order.readOne`; the storefront route resolves the
 * order through `resolveOrderAccess` (the owning customer's session, or the guest's access token, otherwise the same
 * 404 as a missing order). This function never decides who may see an invoice; it only refuses to invent one for an
 * order that has none.
 */
export async function getInvoiceForOrder(order: OrderSchema): Promise<InvoiceView> {
  const [lines, returns] = await Promise.all([
    orderLineRepository.findAll({ where: { orderId: order._id }, sort: { field: "lineNumber", order: SortOrder.ASC } }),
    // Only a refunded return has money to show; a requested, approved or rejected one has refunded nothing.
    returnRepository.findAll({ where: { orderId: order._id, status: "REFUNDED" } }),
  ]);

  // A signed-in customer's pickup order has no guest contact and no delivery recipient: the account is the only name there is.
  const needsAccount = Boolean(order.customerId && !order.guestName && !order.fulfilment.addressSnapshot);
  const customer = needsAccount ? await customerRepository.findOne({ where: { _id: order.customerId }, skipThrowError: true }) : null;

  const view = buildInvoiceView({
    order,
    lines,
    returnRefunds: returns.flatMap((entry) => (entry.refundAmount ? [{ returnNumber: entry.returnNumber, amount: entry.refundAmount, at: entry.processedAt, reference: entry.refundReference }] : [])),
    accountContact: customer ? { name: customer.name, phone: customer.phone, email: customer.email } : undefined,
  });
  if (!view) throw new NotFoundError("This order has no invoice.");
  return view;
}

/** Console: an invoice by order id. 404 for an unknown order and for an order placed before invoices existed. */
export async function getInvoiceByOrderId(orderId: string): Promise<InvoiceView> {
  const order = await orderRepository.findOne({ where: { _id: orderId } });
  return getInvoiceForOrder(order);
}
