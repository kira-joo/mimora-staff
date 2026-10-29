import type { LocalizedString, Money } from "@kira-joo/toolkit-common";
import type mongoose from "mongoose";
import { promotionRepository } from "../core/repositories";
import { promotionActiveWindowFilter } from "../commerce/promotion-active-window";
import type { PromotionSchema } from "../commerce/promotion.schema";

/**
 * Which products an automatic promotion reaches — the catalog's own public ids,
 * so a storefront can badge only the products the promotion really applies to
 * (a badge on every card for a "shirts only" promotion would be a false claim).
 * Variant ids are deliberately not listed: `variantRestricted` says only that
 * the promotion has variant targets, which a product card cannot resolve.
 * Matching mirrors the pricing engine: any one of category, collection or
 * product is enough; none at all means the whole catalogue.
 */
export interface PublicPromotionScope {
  all: boolean;
  categoryIds: string[];
  collectionIds: string[];
  productIds: string[];
  variantRestricted: boolean;
}

/**
 * The public face of an automatic promotion — display fields only. A coded
 * promotion is never listed (the code is the secret being protected), and no
 * usage counter, limit or per-customer rule ever leaves the backend through
 * this unauthenticated route. The scope (public catalog ids) is the only
 * eligibility fact disclosed, and only because a truthful badge cannot be drawn
 * without it. A first-order-only promotion is not listed at all: whether it
 * applies depends on WHO is looking, which an anonymous route cannot know, and
 * advertising it to a returning customer would be a false claim.
 */
export interface PublicPromotionView {
  _id: string;
  name: LocalizedString;
  description: LocalizedString;
  type: PromotionSchema["type"];
  value?: Money;
  minSubtotal?: Money;
  startsAt?: Date;
  endsAt?: Date;
  scope: PublicPromotionScope;
}

/**
 * Automatic (code-less) promotions whose date window currently includes `now`
 * — see `promotionActiveWindowFilter`'s own doc comment for what "active"
 * means here — projected to `PublicPromotionView`.
 */
export async function getActivePromotions(now: Date = new Date()): Promise<PublicPromotionView[]> {
  const promotions = await promotionRepository.findAll({ where: { ...promotionActiveWindowFilter(now), code: { $in: [null, ""] }, "conditions.firstOrderOnly": { $ne: true } } });

  return promotions.map((promotion): PublicPromotionView => ({
    _id: promotion._id.toString(),
    name: promotion.name,
    description: promotion.description,
    type: promotion.type,
    value: promotion.value,
    minSubtotal: promotion.conditions.minSubtotal,
    startsAt: promotion.conditions.startsAt,
    endsAt: promotion.conditions.endsAt,
    scope: toPublicScope(promotion.conditions),
  }));
}

const ids = (values: mongoose.Types.ObjectId[] | undefined) => (values ?? []).map((value) => value.toString());

/** Exported for its own unit test: the "empty means everything" rule is the one that must not invert. */
export function toPublicScope(conditions: PromotionSchema["conditions"]): PublicPromotionScope {
  const categoryIds = ids(conditions.categories);
  const collectionIds = ids(conditions.collections);
  const productIds = ids(conditions.products);
  const variantRestricted = (conditions.variants ?? []).length > 0;
  return { all: categoryIds.length + collectionIds.length + productIds.length === 0 && !variantRestricted, categoryIds, collectionIds, productIds, variantRestricted };
}
