/**
 * The Mongo predicate for "this promotion's date window currently includes
 * `now`" — `active: true` alone is not "currently running":
 * `conditions.startsAt`/`endsAt` gate the window, and either bound being
 * unset means "no restriction on that side" (`PromotionSchema.conditions`'s
 * own doc comment: "every array empty means no restriction... an unset
 * condition must not become a condition" — the same principle extends to
 * an unset date bound).
 *
 * Shared by `get-active-promotions.ts` (storefront listing) and
 * `apply-cart-promotion.ts` (shop cart) — one predicate, not two
 * independently-maintained copies of the same date-window logic.
 */
export function promotionActiveWindowFilter(now: Date = new Date()): Record<string, unknown> {
  return {
    active: true,
    $and: [
      { $or: [{ "conditions.startsAt": { $exists: false } }, { "conditions.startsAt": { $lte: now } }] },
      { $or: [{ "conditions.endsAt": { $exists: false } }, { "conditions.endsAt": { $gte: now } }] },
    ],
  };
}
