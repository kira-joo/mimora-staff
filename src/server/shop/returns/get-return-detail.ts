import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";
import { orderLineRepository, orderRepository, returnLineRepository, returnRepository } from "../../core/repositories";
import { customerReturnStatus } from "../../engines/returns/return-eligibility";
import type { ReturnDetailView } from "./returns.types";

export interface GetReturnDetailInput {
  customer: CustomerIdentity;
  returnId: string;
}

/**
 * Retrieves full return detail for `GET /api/shop/returns/[id]`.
 *
 * `[id]` is the `Return`'s own Mongo `_id` — never the `returnNumber`.
 * Ownership is enforced by `customerId` at the query, matching
 * `getOrderDetail`'s "never reveal another customer's record" contract:
 * a nonexistent id and someone else's return are indistinguishable, both
 * a plain `NotFoundError`.
 *
 * Lines are enriched with their order line's product/SKU snapshot —
 * `ReturnLineSchema` itself only stores the return-specific fields
 * (quantity, reason, condition, disposition). Staff-only fields
 * (`processedBy`, `refundReference`) are never included.
 */
export async function getReturnDetail(input: GetReturnDetailInput): Promise<ReturnDetailView> {
  const { customer, returnId } = input;

  const ret = await returnRepository.findOne({ where: { _id: returnId, customerId: customer._id }, skipThrowError: true });
  if (!ret) {
    throw new NotFoundError("Return not found.");
  }

  const [order, returnLines] = await Promise.all([
    orderRepository.findOne({ where: { _id: ret.orderId }, select: { orderNumber: true }, skipThrowError: true }),
    returnLineRepository.findAll({ where: { returnId: ret._id } }),
  ]);

  const orderLines = await orderLineRepository.findByIds(returnLines.map((line) => line.orderLineId.toString()));
  const orderLineById = new Map(orderLines.map((line) => [line._id.toString(), line]));

  return {
    returnId: ret._id.toString(),
    returnNumber: ret.returnNumber,
    orderNumber: order?.orderNumber ?? "",
    status: customerReturnStatus(ret.status),
    reason: ret.reason,
    requestedAt: ret.requestedAt,
    processedAt: ret.processedAt,
    refundAmount: ret.refundAmount,
    lines: returnLines.map((line) => {
      const orderLine = orderLineById.get(line.orderLineId.toString());
      return {
        orderLineId: line.orderLineId.toString(),
        sku: orderLine?.sku ?? "",
        productName: orderLine?.productName ?? "",
        variantDescription: orderLine?.variantDescription ?? "",
        quantity: line.quantity,
        reason: line.reason,
        condition: line.condition,
        disposition: line.disposition,
      };
    }),
  };
}
