import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { orderRepository, productRepository, returnRepository } from "../../core/repositories";
import { connectToDatabase } from "../../core/db/connect";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { OrderModel, OrderLineModel } from "../../commerce/order.schema";
import { ReturnModel, ReturnLineModel } from "../../commerce/return.schema";
import { StockMovementModel } from "../../catalog/stock-movement.schema";
import { listReturns } from "./list-returns";
import { getReturnDetailAdmin } from "./get-return-detail";
import { approveReturn } from "./approve-return";
import { rejectReturn } from "./reject-return";
import { receiveReturn } from "./receive-return";
import { refundReturn } from "./refund-return";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const injectedSpies: Array<{ mockRestore(): void }> = [];

afterEach(() => {
  while (injectedSpies.length > 0) injectedSpies.pop()!.mockRestore();
});

/**
 * Rollback-test injection. Lets the real write land, THEN fails the `nth` call
 * to `repo[method]` — so the rollback has a write that genuinely happened to
 * undo. Failing before the write would prove nothing about atomicity.
 */
function failAfterWrite(repo: object, method: string, nth = 1): void {
  const target = repo as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = target[method]!.bind(repo);
  let calls = 0;
  const spy = vi.spyOn(target, method).mockImplementation(async (...args: unknown[]) => {
    const result = await original(...args);
    calls += 1;
    if (calls === nth) throw new Error("injected failure");
    return result;
  });
  injectedSpies.push(spy);
}

async function seedOrder() {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString()}`,
    guestPhone: "+201000000000",
    idempotencyKey: `k-${new mongoose.Types.ObjectId().toString()}`,
    fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
    subtotal: toMoney("20.00"),
    discount: toMoney("0.00"),
    tax: toMoney("0.00"),
    total: toMoney("20.00"),
    payment: { method: "COD", status: "NOT_REQUIRED" },
    status: "DELIVERED",
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
    placedAt: new Date(),
  });
}

async function seedVariantAndOrderLine(orderId: mongoose.Types.ObjectId, stock = 5) {
  const category = await CategoryModel.create({ slug: `cat-${new mongoose.Types.ObjectId().toString()}` });
  const product = await ProductModel.create({
    slug: `product-${new mongoose.Types.ObjectId().toString()}`,
    categoryId: category._id,
    lifecycle: "published",
    name: { en: "Test", ar: "تجربة" },
  });
  const variant = await VariantModel.create({
    productId: product._id,
    sku: `SKU-${new mongoose.Types.ObjectId().toString()}`,
    variantKey: `key-${new mongoose.Types.ObjectId().toString()}`,
    price: toMoney("10.00"),
    stock,
  });
  const orderLine = await OrderLineModel.create({
    orderId,
    lineNumber: 1,
    variantId: variant._id,
    sku: variant.sku,
    productName: "Test",
    variantDescription: "Default",
    quantity: 2,
    unitPrice: toMoney("10.00"),
    lineTotal: toMoney("20.00"),
  });
  return { product, variant, orderLine };
}

async function seedReturn(orderId: mongoose.Types.ObjectId, orderLineId: mongoose.Types.ObjectId, status: "REQUESTED" | "APPROVED" | "RECEIVED" = "REQUESTED", lineCount = 1) {
  const ret = await ReturnModel.create({
    orderId,
    returnNumber: `RET-${new mongoose.Types.ObjectId().toString()}`,
    reason: "Wrong size",
    status,
    requestedAt: new Date(),
  });
  const returnLine = await ReturnLineModel.create({
    returnId: ret._id,
    orderLineId,
    quantity: 2,
    reason: "Wrong size",
    condition: "Unopened",
  });
  // Extra lines (against the same order line) for the partial-receipt cases.
  const extraLines = [];
  for (let index = 1; index < lineCount; index += 1) {
    extraLines.push(await ReturnLineModel.create({ returnId: ret._id, orderLineId, quantity: 1, reason: "Wrong size", condition: "Unopened" }));
  }
  return { ret, returnLine, extraLines };
}

describe("Admin Returns", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      OrderModel.deleteMany({}),
      OrderLineModel.deleteMany({}),
      ReturnModel.deleteMany({}),
      ReturnLineModel.deleteMany({}),
      VariantModel.deleteMany({}),
      ProductModel.deleteMany({}),
      CategoryModel.deleteMany({}),
      StockMovementModel.deleteMany({}),
    ]);
  });

  describe("listReturns / getReturnDetailAdmin", () => {
    it("lists returns filtered by status and returns full detail", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id);
      const { ret } = await seedReturn(order._id, orderLine._id);

      const listed = await listReturns({ limit: 10, page: 1, status: "REQUESTED" });
      expect(listed.total).toBe(1);
      expect(listed.data[0]?.orderNumber).toBe(order.orderNumber);

      const detail = await getReturnDetailAdmin(ret._id.toString());
      expect(detail.lines).toHaveLength(1);
      expect(detail.lines[0]?.sku).toBe(orderLine.sku);
    });
  });

  describe("approveReturn / rejectReturn", () => {
    it("approves a requested return", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id);
      const { ret } = await seedReturn(order._id, orderLine._id);

      const updated = await approveReturn({ returnId: ret._id.toString(), staffId: new mongoose.Types.ObjectId().toString(), now: new Date() });
      expect(updated.status).toBe("APPROVED");

      const orderAfter = await OrderModel.findById(order._id).lean();
      expect(orderAfter?.timeline.some((e) => e.type === "RETURN_APPROVED")).toBe(true);
    });

    it("rejects a requested return with a reason", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id);
      const { ret } = await seedReturn(order._id, orderLine._id);

      const updated = await rejectReturn({ returnId: ret._id.toString(), reason: "No proof of purchase", staffId: new mongoose.Types.ObjectId().toString(), now: new Date() });
      expect(updated.status).toBe("REJECTED");
    });

    it("throws ConflictError approving an already-approved return", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id);
      const { ret } = await seedReturn(order._id, orderLine._id, "APPROVED");

      await expect(
        approveReturn({ returnId: ret._id.toString(), staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("receiveReturn", () => {
    it("restocks a RESTOCK line and records a StockMovement", async () => {
      const order = await seedOrder();
      const { variant, orderLine } = await seedVariantAndOrderLine(order._id, 5);
      const { ret, returnLine } = await seedReturn(order._id, orderLine._id, "APPROVED");

      const lines = await receiveReturn({
        returnId: ret._id.toString(),
        lines: [{ returnLineId: returnLine._id.toString(), disposition: "RESTOCK", inspectedCondition: "Unopened, sealed" }],
        staffId: new mongoose.Types.ObjectId().toString(),
        now: new Date(),
      });

      expect(lines[0]?.disposition).toBe("RESTOCK");

      const restockedVariant = await VariantModel.findById(variant._id).lean();
      expect(restockedVariant?.stock).toBe(7); // 5 + 2 returned

      const movement = await StockMovementModel.findOne({ variantId: variant._id }).lean();
      expect(movement?.reason).toBe("RETURN");
      expect(movement?.delta).toBe(2);
    });

    it("does not move stock for a DISCARD line", async () => {
      const order = await seedOrder();
      const { variant, orderLine } = await seedVariantAndOrderLine(order._id, 5);
      const { ret, returnLine } = await seedReturn(order._id, orderLine._id, "APPROVED");

      await receiveReturn({
        returnId: ret._id.toString(),
        lines: [{ returnLineId: returnLine._id.toString(), disposition: "DISCARD", inspectedCondition: "Unopened, sealed" }],
        staffId: new mongoose.Types.ObjectId().toString(),
        now: new Date(),
      });

      const untouchedVariant = await VariantModel.findById(variant._id).lean();
      expect(untouchedVariant?.stock).toBe(5);
    });

    it("records the inspected condition beside the disposition, and the customer's own claim is untouched", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id, 5);
      const { ret, returnLine } = await seedReturn(order._id, orderLine._id, "APPROVED");

      await receiveReturn({
        returnId: ret._id.toString(),
        lines: [{ returnLineId: returnLine._id.toString(), disposition: "DISCARD", inspectedCondition: "  Damaged box, item scratched  " }],
        staffId: new mongoose.Types.ObjectId().toString(),
        now: new Date(),
      });

      const stored = await ReturnLineModel.findById(returnLine._id).lean();
      expect(stored?.inspectedCondition).toBe("Damaged box, item scratched");
      expect(stored?.condition).toBe("Unopened");
      const detail = await getReturnDetailAdmin(ret._id.toString());
      expect(detail.lines[0]).toMatchObject({ condition: "Unopened", inspectedCondition: "Damaged box, item scratched", disposition: "DISCARD" });
    });

    it.each([["blank", "   "], ["missing", undefined as unknown as string]])("refuses a line with a %s inspected condition, and nothing is written", async (_label, inspectedCondition) => {
      const order = await seedOrder();
      const { variant, orderLine } = await seedVariantAndOrderLine(order._id, 5);
      const { ret, returnLine } = await seedReturn(order._id, orderLine._id, "APPROVED");

      await expect(
        receiveReturn({
          returnId: ret._id.toString(),
          lines: [{ returnLineId: returnLine._id.toString(), disposition: "RESTOCK", inspectedCondition }],
          staffId: new mongoose.Types.ObjectId().toString(),
          now: new Date(),
        })
      ).rejects.toThrow(ConflictError);

      expect((await ReturnLineModel.findById(returnLine._id).lean())?.disposition).toBeUndefined();
      expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(5);
      expect((await ReturnModel.findById(ret._id).lean())?.status).toBe("APPROVED");
    });

    it("moves the return APPROVED → RECEIVED once every line is received", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id, 5);
      const { ret, returnLine } = await seedReturn(order._id, orderLine._id, "APPROVED");

      await receiveReturn({
        returnId: ret._id.toString(),
        lines: [{ returnLineId: returnLine._id.toString(), disposition: "RESTOCK", inspectedCondition: "Sealed" }],
        staffId: new mongoose.Types.ObjectId().toString(),
        now: new Date(),
      });

      expect((await ReturnModel.findById(ret._id).lean())?.status).toBe("RECEIVED");
    });

    it("a partial receipt leaves the return APPROVED, and the remaining line can still be received (then RECEIVED)", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id, 5);
      const { ret, returnLine, extraLines } = await seedReturn(order._id, orderLine._id, "APPROVED", 2);
      const staffId = new mongoose.Types.ObjectId().toString();

      await receiveReturn({ returnId: ret._id.toString(), lines: [{ returnLineId: returnLine._id.toString(), disposition: "DISCARD", inspectedCondition: "Broken" }], staffId, now: new Date() });
      expect((await ReturnModel.findById(ret._id).lean())?.status).toBe("APPROVED");

      await receiveReturn({ returnId: ret._id.toString(), lines: [{ returnLineId: extraLines[0]!._id.toString(), disposition: "DISCARD", inspectedCondition: "Broken" }], staffId, now: new Date() });
      expect((await ReturnModel.findById(ret._id).lean())?.status).toBe("RECEIVED");
    });

    it("a RECEIVED return cannot be received again", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id, 5);
      const { ret, returnLine } = await seedReturn(order._id, orderLine._id, "RECEIVED");

      await expect(
        receiveReturn({
          returnId: ret._id.toString(),
          lines: [{ returnLineId: returnLine._id.toString(), disposition: "RESTOCK", inspectedCondition: "Sealed" }],
          staffId: new mongoose.Types.ObjectId().toString(),
          now: new Date(),
        })
      ).rejects.toThrow(ConflictError);
    });

    it("throws ConflictError receiving a line that was already received", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id, 5);
      const { ret, returnLine } = await seedReturn(order._id, orderLine._id, "APPROVED");

      await receiveReturn({
        returnId: ret._id.toString(),
        lines: [{ returnLineId: returnLine._id.toString(), disposition: "DISCARD", inspectedCondition: "Unopened, sealed" }],
        staffId: new mongoose.Types.ObjectId().toString(),
        now: new Date(),
      });

      await expect(
        receiveReturn({
          returnId: ret._id.toString(),
          lines: [{ returnLineId: returnLine._id.toString(), disposition: "RESTOCK", inspectedCondition: "Unopened, sealed" }],
          staffId: new mongoose.Types.ObjectId().toString(),
          now: new Date(),
        })
      ).rejects.toThrow(ConflictError);
    });

    it("throws ConflictError receiving a return that isn't APPROVED", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id);
      const { ret, returnLine } = await seedReturn(order._id, orderLine._id, "REQUESTED");

      await expect(
        receiveReturn({
          returnId: ret._id.toString(),
          lines: [{ returnLineId: returnLine._id.toString(), disposition: "RESTOCK", inspectedCondition: "Unopened, sealed" }],
          staffId: new mongoose.Types.ObjectId().toString(),
          now: new Date(),
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("refundReturn", () => {
    it("refunds an approved return for the explicit amount", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id);
      const { ret } = await seedReturn(order._id, orderLine._id, "APPROVED");

      const updated = await refundReturn({ returnId: ret._id.toString(), refundReference: "TXN-123", amount: toMoney("20.00"), staffId: new mongoose.Types.ObjectId().toString(), now: new Date() });

      expect(updated.status).toBe("REFUNDED");
      expect(updated.refundReference).toBe("TXN-123");
      expect(updated.refundAmount?.toFixed(2)).toBe("20.00");
    });

    it("refunds a RECEIVED return", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id);
      const { ret } = await seedReturn(order._id, orderLine._id, "RECEIVED");

      const updated = await refundReturn({ returnId: ret._id.toString(), refundReference: "  TXN-9  ", amount: toMoney("20.00"), staffId: new mongoose.Types.ObjectId().toString(), now: new Date() });

      expect(updated.status).toBe("REFUNDED");
      expect(updated.refundReference).toBe("TXN-9");
    });

    it("refuses a blank refund reference (D-12), and nothing is recorded", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id);
      const { ret } = await seedReturn(order._id, orderLine._id, "RECEIVED");

      await expect(
        refundReturn({ returnId: ret._id.toString(), refundReference: "   ", amount: toMoney("20.00"), staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })
      ).rejects.toThrow(ConflictError);
      expect((await ReturnModel.findById(ret._id).lean())?.status).toBe("RECEIVED");
      expect(Number(String((await OrderModel.findById(order._id).lean())?.refundedTotal ?? 0))).toBe(0);
    });

    it("throws ConflictError refunding a requested (not yet approved) return", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id);
      const { ret } = await seedReturn(order._id, orderLine._id, "REQUESTED");

      await expect(
        refundReturn({ returnId: ret._id.toString(), refundReference: "TXN-123", amount: toMoney("20.00"), staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })
      ).rejects.toThrow(ConflictError);
    });

    it("throws NotFoundError for a non-existent return", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(
        refundReturn({ returnId: fakeId, refundReference: "TXN-123", amount: toMoney("20.00"), staffId: fakeId, now: new Date() })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("rollback: a failure inside the transaction leaves no partial state", () => {
    it("approveReturn: the APPROVED status and its timeline entry both revert when the failure follows the timeline write", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id);
      const { ret } = await seedReturn(order._id, orderLine._id, "REQUESTED");
      const returnBefore = await ReturnModel.collection.findOne({ _id: ret._id });
      const orderBefore = await OrderModel.collection.findOne({ _id: order._id });
      failAfterWrite(orderRepository, "updateAtomic", 1); // the RETURN_APPROVED timeline $push, after the return write

      await expect(approveReturn({ returnId: ret._id.toString(), staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })).rejects.toThrow("injected failure");

      expect(await ReturnModel.collection.findOne({ _id: ret._id })).toEqual(returnBefore);
      expect(await OrderModel.collection.findOne({ _id: order._id })).toEqual(orderBefore);
      expect((await ReturnModel.findById(ret._id).lean())?.status).toBe("REQUESTED");
    });

    it("rejectReturn: the REJECTED status, its reason and its timeline entry all revert when the failure follows the timeline write", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id);
      const { ret } = await seedReturn(order._id, orderLine._id, "REQUESTED");
      const returnBefore = await ReturnModel.collection.findOne({ _id: ret._id });
      const orderBefore = await OrderModel.collection.findOne({ _id: order._id });
      failAfterWrite(orderRepository, "updateAtomic", 1); // the RETURN_REJECTED timeline $push, after the return write

      await expect(rejectReturn({ returnId: ret._id.toString(), reason: "No proof of purchase", staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })).rejects.toThrow("injected failure");

      expect(await ReturnModel.collection.findOne({ _id: ret._id })).toEqual(returnBefore);
      expect(await OrderModel.collection.findOne({ _id: order._id })).toEqual(orderBefore);
      const after = await ReturnModel.findById(ret._id).lean();
      expect(after?.status).toBe("REQUESTED");
      expect(after?.notes).toBeUndefined();
    });

    it("refundReturn: the reserved refundedTotal, return status/refund fields and the timeline all revert", async () => {
      const order = await seedOrder();
      const { orderLine } = await seedVariantAndOrderLine(order._id);
      const { ret } = await seedReturn(order._id, orderLine._id, "APPROVED");
      failAfterWrite(orderRepository, "updateAtomic", 2); // 1 = reserveOrderRefund, 2 = timeline $push (after the return write)

      await expect(
        refundReturn({ returnId: ret._id.toString(), refundReference: "TXN-1", amount: toMoney("20.00"), staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })
      ).rejects.toThrow("injected failure");

      const afterReturn = await ReturnModel.findById(ret._id).lean();
      expect(afterReturn?.status).toBe("APPROVED");
      expect(afterReturn?.refundReference).toBeUndefined();
      expect(afterReturn?.refundAmount).toBeUndefined();
      const afterOrder = await OrderModel.findById(order._id).lean();
      expect(Number(String(afterOrder?.refundedTotal ?? 0))).toBe(0);
      expect(afterOrder?.timeline).toHaveLength(1);
    });

    it("receiveReturn: disposition, restocked quantity, stock movement and rollup all revert", async () => {
      const order = await seedOrder();
      const { product, variant, orderLine } = await seedVariantAndOrderLine(order._id, 5);
      const { ret, returnLine } = await seedReturn(order._id, orderLine._id, "APPROVED");
      const listingBefore = (await ProductModel.findById(product._id).lean())?.listing;
      failAfterWrite(orderRepository, "updateAtomic", 1); // the RETURN_RECEIVED timeline $push, last write of the transaction

      await expect(
        receiveReturn({
          returnId: ret._id.toString(),
          lines: [{ returnLineId: returnLine._id.toString(), disposition: "RESTOCK", inspectedCondition: "Unopened, sealed" }],
          staffId: new mongoose.Types.ObjectId().toString(),
          now: new Date(),
        })
      ).rejects.toThrow("injected failure");

      expect((await ReturnLineModel.findById(returnLine._id).lean())?.disposition).toBeUndefined();
      expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(5);
      expect(await StockMovementModel.countDocuments({ variantId: variant._id })).toBe(0);
      expect((await ProductModel.findById(product._id).lean())?.listing).toEqual(listingBefore);
      expect((await OrderModel.findById(order._id).lean())?.timeline).toHaveLength(1);
    });

    it("receiveReturn: when the RECEIVED status write is the failure, the dispositions, inspected conditions and stock revert too", async () => {
      const order = await seedOrder();
      const { variant, orderLine } = await seedVariantAndOrderLine(order._id, 5);
      const { ret, returnLine } = await seedReturn(order._id, orderLine._id, "APPROVED");
      failAfterWrite(returnRepository, "updateAtomic", 1); // the APPROVED → RECEIVED write, the very last of the transaction

      await expect(
        receiveReturn({
          returnId: ret._id.toString(),
          lines: [{ returnLineId: returnLine._id.toString(), disposition: "RESTOCK", inspectedCondition: "Sealed" }],
          staffId: new mongoose.Types.ObjectId().toString(),
          now: new Date(),
        })
      ).rejects.toThrow("injected failure");

      const line = await ReturnLineModel.findById(returnLine._id).lean();
      expect(line?.disposition).toBeUndefined();
      expect(line?.inspectedCondition).toBeUndefined();
      expect((await ReturnModel.findById(ret._id).lean())?.status).toBe("APPROVED");
      expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(5);
      expect(await StockMovementModel.countDocuments({ variantId: variant._id })).toBe(0);
      expect((await OrderModel.findById(order._id).lean())?.timeline).toHaveLength(1);
    });
  });
});
