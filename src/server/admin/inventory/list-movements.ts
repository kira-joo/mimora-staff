import { SortOrder, type LocalizedString, type PaginatedResponse } from "@kira-joo/toolkit-common";
import { customerRepository, orderRepository, productRepository, staffUserRepository, stockMovementRepository, variantRepository } from "../../core/repositories";
import type { ListInventoryMovementsQueryDto } from "../dto/list-inventory-movements-query.dto";

export interface StockMovementView {
  _id: string;
  variantId: string;
  sku: string;
  productName: LocalizedString;
  /** Signed: positive added stock, negative removed it. */
  delta: number;
  reason: "SALE" | "RETURN" | "ADJUSTMENT" | "RECEIPT" | "DAMAGE";
  orderId?: string;
  orderNumber?: string;
  /** Absent for a guest's sale. `kind` says which collection `name` came from. */
  actor?: { _id: string; kind: "STAFF" | "CUSTOMER"; name?: string };
  note?: string;
  at: Date;
}

/**
 * The Adjustments log: every change to a variant's stock, newest first by the
 * movement's effective time (`at`), filterable by variant, product and reason.
 * Read-only — rows are written only by placement, cancellation, returns and the
 * adjust routes, in the transaction that moves the stock.
 */
export async function listMovements(query: ListInventoryMovementsQueryDto): Promise<PaginatedResponse<StockMovementView>> {
  const { variantId, productId, reason, ...rest } = query;
  const where: Record<string, unknown> = {};

  if (variantId) where.variantId = variantId;
  if (reason) where.reason = reason;
  if (productId) {
    const variants = await variantRepository.findAll({ where: { productId }, select: { _id: true } });
    const ids = variants.map((variant) => variant._id);
    // A product's movements, narrowed by an explicit variant when both are given.
    where.variantId = variantId ? (ids.some((id) => id.toString() === variantId) ? variantId : { $in: [] }) : { $in: ids };
  }

  const result = await stockMovementRepository.findAllAndCountPublic({
    where,
    query: { sortBy: "at", sortOrder: SortOrder.DESC, ...rest },
  });

  const unique = (values: Array<{ toString(): string } | undefined>) => [...new Set(values.filter((value) => value !== undefined).map((value) => value!.toString()))];
  const variantIds = unique(result.data.map((movement) => movement.variantId));
  const orderIds = unique(result.data.map((movement) => movement.orderId));
  const actorIds = unique(result.data.map((movement) => movement.actorId));

  const [variants, orders, staff, customers] = await Promise.all([
    variantRepository.findByIds(variantIds, { select: { sku: true, productId: true } }),
    orderIds.length ? orderRepository.findByIds(orderIds, { select: { orderNumber: true } }) : [],
    actorIds.length ? staffUserRepository.findByIds(actorIds, { select: { name: true } }) : [],
    actorIds.length ? customerRepository.findByIds(actorIds, { select: { name: true } }) : [],
  ]);
  const products = await productRepository.findByIds(unique(variants.map((variant) => variant.productId)), { select: { name: true } });

  const variantById = new Map(variants.map((variant) => [variant._id.toString(), variant]));
  const productById = new Map(products.map((product) => [product._id.toString(), product]));
  const orderById = new Map(orders.map((order) => [order._id.toString(), order]));
  const staffById = new Map(staff.map((member) => [member._id.toString(), member]));
  const customerById = new Map(customers.map((customer) => [customer._id.toString(), customer]));

  return {
    ...result,
    data: result.data.map((movement) => {
      const variant = variantById.get(movement.variantId.toString());
      const product = variant ? productById.get(variant.productId.toString()) : undefined;
      const actorKey = movement.actorId?.toString();
      const staffMember = actorKey ? staffById.get(actorKey) : undefined;
      const customer = actorKey && !staffMember ? customerById.get(actorKey) : undefined;

      return {
        _id: movement._id.toString(),
        variantId: movement.variantId.toString(),
        sku: variant?.sku ?? "",
        productName: product?.name ?? { ar: "", en: "" },
        delta: movement.delta,
        reason: movement.reason,
        orderId: movement.orderId?.toString(),
        orderNumber: movement.orderId ? orderById.get(movement.orderId.toString())?.orderNumber : undefined,
        actor: actorKey ? { _id: actorKey, kind: customer ? ("CUSTOMER" as const) : ("STAFF" as const), name: (staffMember ?? customer)?.name } : undefined,
        note: movement.note,
        at: movement.at,
      };
    }),
  };
}
