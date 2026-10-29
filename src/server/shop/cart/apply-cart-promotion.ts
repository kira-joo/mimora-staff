import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { promotionActiveWindowFilter } from "../../commerce/promotion-active-window";
import { cartRepository, cartLineRepository, promotionRepository } from "../../core/repositories";
import type { ShopActor } from "../shop-actor";
import { cartFilterForActor } from "./cart-actor-filter";
import { toCartView, type CartView } from "./cart-view";
import { CART_LINE_ORDER } from "./cart-line-order";

/**
 * `POST /api/shop/cart/promotion`. Checks only that `code` currently names
 * a real, active, in-window promotion — never full eligibility
 * (`minSubtotal`, category/product scoping, `firstOrderOnly`, per-customer
 * usage limits, stacking). That evaluation needs the cart's priced
 * contents and the customer's order history, which is exactly what MDS
 * §11.2 calls `POST /quote` — "authoritative pricing for the current cart
 * + fulfilment" — not this route. `evaluatePromotion()` is deliberately
 * NOT called here for the same reason.
 *
 * Codes are stored `uppercase: true` (`PromotionSchema.code`); normalizing
 * the lookup the same way is what makes a customer typing lowercase still
 * find it.
 *
 * @throws {NotFoundError} No cart exists yet, or `code` doesn't currently name an active promotion.
 */
export async function applyCartPromotion(actor: ShopActor, code: string): Promise<CartView> {
  const normalizedCode = code.trim().toUpperCase();

  const promotion = await promotionRepository.findOne({
    where: { code: normalizedCode, ...promotionActiveWindowFilter() },
    skipThrowError: true,
  });
  if (!promotion) throw new NotFoundError("This promotion code is not currently valid.");

  const cart = await cartRepository.updateAtomic(
    cartFilterForActor(actor),
    { $set: { appliedPromotionCode: normalizedCode } },
    { skipThrowError: true }
  );
  if (!cart) throw new NotFoundError("No cart exists yet — add a line first.");

  const lines = await cartLineRepository.findAll({ where: { cartId: cart._id }, sort: CART_LINE_ORDER });
  return toCartView(cart, lines);
}
