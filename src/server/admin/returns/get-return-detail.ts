import { orderLineRepository, orderRepository, returnLineRepository, returnRepository } from "../../core/repositories";

/** Admin variant of the shop's own getReturnDetail — no ownership scoping, and includes returnLineId/variantId, which staff need to act on (receive/restock) but a customer never sees. */
export async function getReturnDetailAdmin(returnId: string) {
  const ret = await returnRepository.findOne({ where: { _id: returnId } });

  const [order, returnLines] = await Promise.all([
    orderRepository.findOne({ where: { _id: ret.orderId }, select: { orderNumber: true }, skipThrowError: true }),
    returnLineRepository.findAll({ where: { returnId: ret._id } }),
  ]);

  const orderLines = await orderLineRepository.findByIds(returnLines.map((line) => line.orderLineId.toString()));
  const orderLineById = new Map(orderLines.map((line) => [line._id.toString(), line]));

  return {
    _id: ret._id.toString(),
    returnNumber: ret.returnNumber,
    orderId: ret.orderId.toString(),
    orderNumber: order?.orderNumber ?? "",
    customerId: ret.customerId?.toString(),
    status: ret.status,
    reason: ret.reason,
    requestedAt: ret.requestedAt,
    processedAt: ret.processedAt,
    processedBy: ret.processedBy?.toString(),
    refundReference: ret.refundReference,
    refundAmount: ret.refundAmount,
    notes: ret.notes,
    lines: returnLines.map((line) => {
      const orderLine = orderLineById.get(line.orderLineId.toString());
      return {
        returnLineId: line._id.toString(),
        orderLineId: line.orderLineId.toString(),
        variantId: orderLine?.variantId.toString() ?? "",
        sku: orderLine?.sku ?? "",
        productName: orderLine?.productName ?? "",
        variantDescription: orderLine?.variantDescription ?? "",
        quantity: line.quantity,
        reason: line.reason,
        condition: line.condition,
        inspectedCondition: line.inspectedCondition,
        disposition: line.disposition,
      };
    }),
  };
}
