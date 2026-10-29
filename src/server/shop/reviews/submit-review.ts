import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";
import { orderLineRepository, orderRepository, productRepository, reviewRepository, variantRepository } from "../../core/repositories";
import { buildReviewKey } from "../../content/review.schema";
import { canReviewProduct } from "../../engines/review-eligibility/check-review-eligibility";
import type { ReviewableOrder } from "../../engines/review-eligibility/check-review-eligibility";
import type { ReviewView } from "./reviews.types";

export interface SubmitReviewInput {
  customer: CustomerIdentity;
  productId: string;
  rating: number;
  title: string;
  body: string;
  locale: "en" | "ar";
}

/**
 * Creates or edits a review for `POST /api/shop/reviews` — the canonical
 * create-or-edit operation (D-2). An atomic upsert keyed by
 * `customerProductKey` is the whole mechanism: no separate route, no
 * transaction (one document, one collection), and the DB-level unique
 * index — not a check-then-write race — is what actually prevents two
 * concurrent submissions from creating two reviews.
 *
 * Eligibility reuses `canReviewProduct` as-is (never duplicated here). The
 * engine needs `{customerId, status, productIds}` per order, but
 * `OrderLine` snapshots `variantId`, not `productId` — this service does
 * the `Order(DELIVERED) → OrderLine → Variant → Product` join the engine's
 * own doc comment assumes the caller already did.
 *
 * Editing always resets `status` to `PENDING` and clears prior moderation
 * metadata (D-3) — edited content has not been reviewed yet, whether the
 * previous submission was `PENDING`, `APPROVED`, or `REJECTED`.
 */
export async function submitReview(input: SubmitReviewInput): Promise<ReviewView> {
  const { customer, productId, rating, title, body, locale } = input;

  const product = await productRepository.findOne({ where: { _id: productId }, skipThrowError: true });
  if (!product) {
    throw new NotFoundError("Product not found.");
  }

  const deliveredOrders = await orderRepository.findAll({
    // A completed order: DELIVERED, or COLLECTED for pickup (`isCompletedStatus`).
    where: { customerId: customer._id, status: { $in: ["DELIVERED", "COLLECTED"] } },
    select: { status: true },
  });

  const orderLines = deliveredOrders.length
    ? await orderLineRepository.findAll({
        where: { orderId: { $in: deliveredOrders.map((order) => order._id) } },
        select: { orderId: true, variantId: true },
      })
    : [];

  const variantIds = [...new Set(orderLines.map((line) => line.variantId.toString()))];
  const variants = variantIds.length
    ? await variantRepository.findByIds(variantIds, { select: { productId: true } })
    : [];
  const productIdByVariant = new Map(variants.map((variant) => [variant._id.toString(), variant.productId.toString()]));

  const productIdsByOrder = new Map<string, Set<string>>();
  for (const line of orderLines) {
    const purchasedProductId = productIdByVariant.get(line.variantId.toString());
    if (!purchasedProductId) continue;
    const orderKey = line.orderId.toString();
    if (!productIdsByOrder.has(orderKey)) productIdsByOrder.set(orderKey, new Set());
    productIdsByOrder.get(orderKey)!.add(purchasedProductId);
  }

  const reviewableOrders: ReviewableOrder[] = deliveredOrders.map((order) => ({
    customerId: customer._id,
    status: order.status,
    productIds: [...(productIdsByOrder.get(order._id.toString()) ?? [])],
  }));

  if (!canReviewProduct(productId, reviewableOrders)) {
    throw new ConflictError("You can only review a product from a delivered order.");
  }

  const matchingOrder = deliveredOrders.find((order) => productIdsByOrder.get(order._id.toString())?.has(productId));

  const customerProductKey = buildReviewKey(customer._id, productId);
  const otherLocale = locale === "en" ? "ar" : "en";

  await reviewRepository.updateAtomic(
    { customerProductKey },
    {
      $set: {
        rating,
        title: { [locale]: title, [otherLocale]: "" },
        body: { [locale]: body, [otherLocale]: "" },
        status: "PENDING",
        verifiedPurchase: true,
        orderId: matchingOrder?._id,
      },
      $setOnInsert: {
        customerId: new mongoose.Types.ObjectId(customer._id),
        productId: new mongoose.Types.ObjectId(productId),
        customerProductKey,
      },
      $unset: { moderatedBy: "", moderatedAt: "" },
    },
    { upsert: true }
  );

  // A separate read, not the upsert's own return value — matches
  // `add-cart-line.ts`'s established precedent for this exact idiom.
  const review = await reviewRepository.findOne({ where: { customerProductKey } });

  return {
    reviewId: review._id.toString(),
    productId: review.productId.toString(),
    rating: review.rating,
    title: review.title,
    body: review.body,
    status: review.status,
    verifiedPurchase: review.verifiedPurchase,
  };
}
