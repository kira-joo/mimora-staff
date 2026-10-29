import type mongoose from "mongoose";
import { customerRepository } from "../../core/repositories";

interface NameableOrder {
  customerId?: mongoose.Types.ObjectId;
  guestName?: string;
  fulfilment: { addressSnapshot?: { recipientName: string } };
}

/**
 * The name to show for each order, in one query: the guest contact's name, else the registered account's, else the
 * delivery recipient (the one name every delivery order carries). Pickup orders by an account with no name resolve
 * through the account; an order with none of these has no name and the console says "Guest".
 *
 * Read-time lookup of the account name is deliberate — it is a label for a list, never part of a document that must
 * not change (the invoice and packing slip use the order's own snapshots).
 */
export async function resolveOrderCustomerNames(orders: readonly (NameableOrder & { _id: mongoose.Types.ObjectId })[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const needAccount = new Set<string>();

  for (const order of orders) {
    if (order.guestName) names.set(order._id.toString(), order.guestName);
    else if (order.customerId) needAccount.add(order.customerId.toString());
    else if (order.fulfilment.addressSnapshot?.recipientName) names.set(order._id.toString(), order.fulfilment.addressSnapshot.recipientName);
  }

  if (needAccount.size > 0) {
    const customers = await customerRepository.findAll({ where: { _id: { $in: [...needAccount] } }, select: { name: true } });
    const nameById = new Map(customers.map((customer) => [customer._id.toString(), customer.name]));
    for (const order of orders) {
      if (names.has(order._id.toString()) || !order.customerId) continue;
      const accountName = nameById.get(order.customerId.toString()) ?? order.fulfilment.addressSnapshot?.recipientName;
      if (accountName) names.set(order._id.toString(), accountName);
    }
  }
  return names;
}
