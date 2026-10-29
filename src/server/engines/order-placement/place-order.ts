import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { resolveSession, withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { resolveLocalized, sum } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { maintainProductListingRollup } from "../../catalog/rollups/maintain-product-listing";
import { CartLineModel } from "../../commerce/cart-line.schema";
import {
  cartRepository,
  cartLineRepository,
  orderLineRepository,
  orderRepository,
  productRepository,
  promotionRepository,
  storeProfileRepository,
  variantRepository,
} from "../../core/repositories";
import { calculatePricing } from "../pricing/calculate-pricing";
import type { AppliedDiscount } from "../pricing/pricing.types";
import { initialPaymentStatus } from "../order-state/order-state-machine";
import { resolveOrderPromotion } from "../../shop/order/resolve-order-promotion";
import { resolvePurchasability } from "../purchasability/resolve-purchasability";
import { meetsOrderMinimum, resolveShipping } from "../shipping/resolve-shipping";
import { allocateOrderNumber } from "../order-number/allocate-order-number";
import { allocateInvoiceNumber } from "../../invoices/allocate-invoice-number";
import { aggregateReservations, recordSaleMovements, reserveStock } from "./reserve-stock";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";
import type { PlaceOrderInput, PlacedOrderResult } from "./place-order.types";

/**
 * The transactional orchestration: re-price authoritatively, re-check
 * purchasability, decrement per-variant stock, allocate the order number,
 * allocate the invoice number, snapshot everything including the SKU, create
 * the order, clear the cart — or none of it.
 *
 * **No external I/O anywhere inside** — no notification, no cache
 * invalidation, no upload. A transaction is retried on a transient conflict,
 * and anything with an outside effect would happen twice. Those belong to the
 * route layer's `onCommit`, once this engine has a caller.
 *
 * **Idempotency is deliberately not this engine's concern.** It belongs to
 * the route factory (`createPostRoute({ idempotent: true })`) one layer up,
 * exactly as in the restaurant precedent — an idempotency key gates whether
 * this function runs at all, which is a routing decision, not a pricing one.
 */
export async function placeOrder(input: PlaceOrderInput): Promise<PlacedOrderResult> {
  return withTransaction(async (tx) => {
    // A retried attempt waits (jittered) before touching anything — see contention-backoff.ts.
    await backOffBeforeRetry(tx.attempt);
    if (!input.customerId && !input.guestContact) {
      throw new ConflictError("An order needs either a signed-in customer or guest contact details.");
    }

    const cart = await cartRepository.findOne({ where: { _id: input.cartId }, lean: true });

    /*
     * `CartLine` is a standalone collection (Phase 4B Batch 3's
     * design-checkpoint conversion from an embedded `Cart.lines[]`) — read
     * once, inside this same transaction/session, and used everywhere
     * below in place of the old `cart.lines`.
     */
    const cartLines = await cartLineRepository.findAll({ where: { cartId: cart._id }, lean: true });
    if (cartLines.length === 0) throw new ConflictError("This cart has no lines to order.");

    const variantIds = cartLines.map((line) => line.variantId);
    /*
     * The repository's lean reads are already sanitized — `Money` fields
     * arrive as `Decimal`, which every `.mul()`/`.plus()` below needs.
     */
    const variants = await variantRepository.findByIds(variantIds.map((id) => id.toString()));
    const variantById = new Map(variants.map((variant) => [variant._id.toString(), variant]));

    const productIds = [...new Set(variants.map((variant) => variant.productId.toString()))].map(
      (id) => new mongoose.Types.ObjectId(id)
    );
    const products = await productRepository.findByIds(productIds.map((id) => id.toString()));
    const productById = new Map(products.map((product) => [product._id.toString(), product]));

    /*
     * Re-check purchasability authoritatively. The variant matrix engine's
     * check at render time and the storefront's own client-side check at
     * add-to-cart are both advisory — this is the check that actually gates
     * the order, per the Phase 3 spec's "the server re-validates at
     * add-to-cart and at placement regardless."
     */
    for (const line of cartLines) {
      const variant = variantById.get(line.variantId.toString());
      if (!variant) throw new NotFoundError(`A cart line references a variant that no longer exists.`);

      const product = productById.get(variant.productId.toString());
      if (!product) throw new NotFoundError(`A cart line references a product that no longer exists.`);

      const purchasability = resolvePurchasability({
        productLifecycle: product.lifecycle,
        discontinued: variant.discontinued,
        stock: variant.stock,
        backorderPolicy: variant.backorderPolicy,
        requestedQuantity: line.quantity,
      });

      if (!purchasability.purchasable) {
        throw new ConflictError(`"${variant.sku}" is no longer available (${purchasability.reason}).`);
      }
    }

    /*
     * Re-price authoritatively, including the promotion. A promotion that
     * expired or hit its usage limit between add-to-cart and placement is
     * dropped from the total silently rather than blocking the order — the
     * customer is not at fault for a campaign ending mid-checkout, and the
     * price shown at placement is the one that governs regardless.
     */
    const pricingLines = cartLines.map((line) => {
      const variant = variantById.get(line.variantId.toString())!;
      return { unitBasePrice: variant.price, quantity: line.quantity };
    });
    const subtotal = sum(pricingLines.map((line) => line.unitBasePrice.mul(line.quantity)));

    // Shipping first: a free-shipping promotion is valued at the fee it waives, exactly as the quote values it.
    const shippingResult = resolveShipping({
      mode: input.fulfilment.mode,
      zoneName: input.fulfilment.zoneName,
      zones: input.shippingSettings.zones,
      deliveryEnabled: input.shippingSettings.deliveryEnabled,
      pickupEnabled: input.shippingSettings.pickupEnabled,
      shippingFeeMode: input.shippingSettings.shippingFeeMode,
      flatShippingFee: input.shippingSettings.flatShippingFee,
      defaultDispatchLeadDays: input.shippingSettings.defaultDispatchLeadDays,
      cutoffTime: input.shippingSettings.cutoffTime,
      placedAt: input.now,
      timeZone: input.shippingSettings.timeZone,
      operatingHours: input.shippingSettings.operatingHours,
      maxDaysAhead: input.shippingSettings.maxDaysAhead,
      storeWideOrderMinimum: input.shippingSettings.storeWideOrderMinimum,
    });

    if (!shippingResult.resolvable) {
      throw new ConflictError(`Fulfilment is not available (${shippingResult.reason}).`);
    }

    if (!meetsOrderMinimum(subtotal, shippingResult.orderMinimum)) {
      throw new ConflictError("This order is below the minimum for the selected fulfilment option.");
    }
    const shippingFee = input.fulfilment.mode === "DELIVERY" ? shippingResult.fee : undefined;

    // The same choice the quote made (resolve-order-promotion.ts): the cart's code, if any, and every
    // active automatic promotion, judged by one engine, best for the customer wins. In-transaction, so
    // the usage history it reads is this attempt's snapshot.
    const resolved = await resolveOrderPromotion({
      code: cart.appliedPromotionCode,
      customerId: input.customerId?.toString(),
      now: input.now,
      subtotal,
      shippingFee,
      lines: cartLines.map((line) => {
        const variant = variantById.get(line.variantId.toString())!;
        const product = productById.get(variant.productId.toString())!;
        return {
          categoryId: product.categoryId.toString(),
          collectionIds: product.collectionIds.map(String),
          productId: product._id.toString(),
          variantId: variant._id.toString(),
          lineTotal: variant.price.mul(line.quantity),
        };
      }),
    });

    let discount: AppliedDiscount | undefined;
    let appliedPromotion: { id: mongoose.Types.ObjectId; code?: string } | undefined;

    /*
     * Record the use NOW, in this transaction. Every applied redemption writes
     * this one document, so two concurrent redemptions of the same promotion
     * always write-conflict: the loser re-runs from the top after the winner
     * committed, and its re-read of `usageCount` and its per-customer count
     * then include the winner's order. That conflict is what makes both limits
     * hold under concurrency. The `usageCount < cap` filter is defence in depth;
     * a miss means the promotion ran out between quote and placement — dropped,
     * as an expired one is (comment above).
     */
    if (resolved) {
      const { promotion } = resolved;
      const cap = promotion.limits?.totalUses;
      const recorded = await promotionRepository.updateAtomic(
        { _id: promotion._id, ...(cap != null ? { usageCount: { $lt: cap } } : {}) },
        { $inc: { usageCount: 1 } },
        { skipThrowError: true }
      );
      if (recorded) {
        discount = resolved.evaluation.effect;
        appliedPromotion = { id: promotion._id as mongoose.Types.ObjectId, code: promotion.code };
      }
    }

    const pricing = calculatePricing({
      lines: pricingLines,
      discount,
      shippingFee,
      tax: input.tax,
    });

    // Decrement stock — aggregated and canonically ordered, see reserve-stock.ts.
    const reservations = aggregateReservations(
      cartLines.map((line) => {
        const variant = variantById.get(line.variantId.toString())!;
        return { variantId: variant._id, quantity: line.quantity, backorderPolicy: variant.backorderPolicy };
      })
    );
    const { soldOut } = await reserveStock(reservations);

    /*
     * A variant selling out changes `Product.listing` (purchasable count,
     * sale signal, fallback image) — maintained here, in the same
     * transaction as the decrement, per MDS §12's "maintained
     * transactionally with the variant write that changes them." Only the
     * products of variants this order SOLD OUT can change: an order touches
     * nothing else the rollup reads. Recomputing every ordered product made
     * each popular product's document a write hot spot for every order of
     * it (2026-10-21: three concurrent buyers exhausted the retry budget as
     * a 503). One product may have several sold-out variants; recompute
     * each affected product once.
     */
    const affectedProductIds = [...new Set(soldOut.map((variantId) => variantById.get(variantId.toString())!.productId.toString()))].map(
      (id) => new mongoose.Types.ObjectId(id)
    );
    for (const affectedProductId of affectedProductIds) {
      await maintainProductListingRollup(affectedProductId);
    }

    const orderNumber = await allocateOrderNumber();

    /*
     * The invoice number comes from its own counter, in THIS transaction: a placement that fails after this line
     * returns it. The seller is read here too and frozen onto the order — the invoice is built from the order alone,
     * so renaming the store or changing its tax mode later never alters an invoice already issued. No store profile
     * (a bare test database) simply leaves the seller off; the number and the tax snapshot are always written.
     */
    const invoiceNumber = await allocateInvoiceNumber();
    const profile = await storeProfileRepository.findOne({ where: {}, skipThrowError: true, lean: true });

    const fulfilmentSnapshot = {
      mode: input.fulfilment.mode,
      addressSnapshot: input.fulfilment.addressSnapshot,
      pickupLocationSnapshot: input.fulfilment.pickupLocationSnapshot,
      // Snapshotted in the order's locale when the caller supplied one (the matching key stays English).
      zone: input.shippingSettings.zones.find((zone) => zone.zone === shippingResult.zone)?.label ?? shippingResult.zone,
      /*
       * Informational reference only — `zone`/`fee`/`dispatchBy`/
       * `promisedWindow` above remain the historically-correct snapshot on
       * their own; `zoneId` never substitutes for them and is never
       * re-read to reconstruct fulfilment terms. Mongoose casts this
       * string to ObjectId on write. Absent for PICKUP and for `FLAT`
       * delivery, matching `resolveShipping`'s own zoneId being unset in
       * both cases.
       */
      zoneId: shippingResult.zoneId,
      fee: shippingResult.fee,
      dispatchBy: shippingResult.dispatchBy,
      promisedWindow: shippingResult.promisedWindow,
    };

    const paymentStatus = initialPaymentStatus(input.requiresPaymentProof, input.requiresProviderIntegration);

    const order = await orderRepository.save({
      orderNumber,
      customerId: input.customerId,
      // The promotion given, frozen — and the stable id per-customer usage is counted by.
      ...(appliedPromotion && resolved
        ? {
            appliedPromotion: {
              promotionId: appliedPromotion.id,
              code: appliedPromotion.code,
              automatic: resolved.automatic,
              name: resolved.promotion.name,
              type: resolved.promotion.type,
              value: resolved.promotion.value,
            },
          }
        : {}),
      guestPhone: input.guestContact?.phone,
      guestEmail: input.guestContact?.email,
      guestName: input.guestContact?.name,
      idempotencyKey: input.idempotencyKey,
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      invoiceNumber,
      invoiceSnapshot: {
        issuedAt: input.now,
        ...(profile ? { seller: { name: profile.name, phone: profile.contact?.phone, email: profile.contact?.email } } : {}),
        tax: { mode: input.tax.mode, rate: input.tax.rate },
      },
      fulfilment: fulfilmentSnapshot,
      subtotal: pricing.subtotal,
      discount: pricing.discount,
      tax: pricing.tax,
      total: pricing.total,
      payment: { method: input.paymentMethod, status: paymentStatus, destinationSnapshot: input.paymentDestination, instructionsSnapshot: input.paymentInstructions },
      status: "PLACED",
      /*
       * Always `actorType: "CUSTOMER"` — a guest checkout is still a
       * customer action, just without an account. `"SYSTEM"` is
       * reserved for genuinely unattended transitions (an auto-cancel
       * on a payment timeout), not for "no `customerId` happened to be
       * present."
       */
      timeline: [{ type: "ORDER_PLACED", at: input.now, actorType: "CUSTOMER", actorId: input.customerId }],
      placedAt: input.now,
      // The customer's own cancel deadline — the window is merchant configuration, the deadline is per-order.
      customerCancelUntil: new Date(input.now.getTime() + input.shippingSettings.customerCancelWindowMinutes * 60_000),
      termsVersionAccepted: input.termsVersionAccepted,
      acceptedAt: input.now,
    });

    // The audit rows for the decrement above — same transaction, so a rollback leaves neither.
    await recordSaleMovements(reservations, { orderId: order._id, actorId: input.customerId, at: input.now });

    await orderLineRepository.save(
      cartLines.map((line, index) => {
        const variant = variantById.get(line.variantId.toString())!;
        const product = productById.get(variant.productId.toString())!;

        /*
         * `OrderLine.productName`/`variantDescription` are plain `String`
         * fields, not `LocalizedString` — a Phase 2 schema fact this engine
         * works within rather than one it invents. `resolveLocalized` (from
         * `@kira-joo/toolkit-common`) picks the requested locale with an
         * honest fallback to the other one if it's blank.
         */
        const productName = resolveLocalized(product.name, input.locale);
        /*
         * A product with zero option axes (a single-variant product with
         * nothing to choose) has no option values to join — `required: true`
         * on this field still rejects an empty string, so it falls back to
         * the product name, which is exactly what such a variant "is".
         */
        /*
         * The options as the customer SAW them: the merchant's localized value
         * label where one exists (B-11), the raw value key otherwise — a snapshot
         * records what was agreed, and "olive / S" is not what an Arabic page showed.
         */
        const variantDescription =
          variant.optionValues.length > 0
            ? variant.optionValues
                .map((option) => {
                  const label = product.optionAxes?.find((axis) => axis.key === option.key)?.values?.find((value) => value.key === option.value)?.label;
                  return (label && resolveLocalized(label, input.locale)) || option.value;
                })
                .join(" / ")
            : productName;

        return {
          orderId: order._id,
          lineNumber: index + 1,
          variantId: variant._id,
          productId: product._id,
          sku: variant.sku,
          productName,
          variantDescription,
          quantity: line.quantity,
          unitPrice: variant.price,
          lineTotal: variant.price.mul(line.quantity),
          ...(variant.costPrice ? { unitCost: variant.costPrice } : {}),
          // The applied-promotion snapshot (OrderLineSchema.promotionCode) — what a customer's
          // per-promotion use count is derived from (derive-promotion-context.ts).
          ...(appliedPromotion?.code ? { promotionCode: appliedPromotion.code.toUpperCase() } : {}),
        };
      })
    );

    // The promotion use was recorded when it was applied (above), conditionally.

    // Direct Model use: the repository has no `deleteMany`; the ambient session is passed explicitly.
    await CartLineModel.deleteMany({ cartId: cart._id }, { session: resolveSession() });
    await cartRepository.updateAtomic({ _id: cart._id }, { $unset: { appliedPromotionCode: "" } }, { skipThrowError: true });

    // Lean re-read (not the hydrated `order`) so the Money fields in the result keep their plain wire format.
    const createdLean = await orderRepository.findOne({ where: { _id: order._id }, skipThrowError: true });
    if (!createdLean) throw new Error("Order vanished immediately after creation.");

    return tx.complete({
      orderId: createdLean._id,
      orderNumber: createdLean.orderNumber,
      subtotal: createdLean.subtotal,
      discount: createdLean.discount,
      tax: createdLean.tax,
      total: createdLean.total,
      status: createdLean.status,
      paymentStatus: createdLean.payment.status,
      invoiceNumber,
    });
  }, { maxRetries: CONTENDED_MAX_RETRIES });
}
