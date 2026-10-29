import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { buildCartLineIdentityKey } from "../../commerce/cart-line.schema";
import { cartLineRepository, cartRepository } from "../../core/repositories";
import { CART_LINE_ORDER } from "./cart-line-order";

export interface CartMergeResult {
  merged: boolean;
  /** How many guest lines were carried into the customer's cart (a combined line counts once). */
  lineCount: number;
}

const NOT_MERGED: CartMergeResult = { merged: false, lineCount: 0 };

/**
 * Carries a guest's cart into the customer's own on sign-in — explicit and
 * non-destructive (MDS §7, §11), in ONE transaction:
 *
 * - **Customer has no cart** → the guest cart is re-keyed to the customer
 *   (`customerId` set, `cartToken` unset). Its lines come along untouched.
 * - **Both exist** → each guest line either folds into the customer line with
 *   the same `(variantId, note)` identity (quantities add) or moves across.
 *   The customer cart's fulfilment draft and promotion code win; the guest's
 *   are adopted only where the customer has none. The guest cart is deleted.
 *
 * No guest cart for the token (absent, unknown, already merged) is a quiet
 * `{ merged: false }` — not an error.
 */
export async function mergeGuestCart(customerId: string, cartToken: string | null | undefined): Promise<CartMergeResult> {
  if (!cartToken) return NOT_MERGED;
  const customerObjectId = new mongoose.Types.ObjectId(customerId);

  return withTransaction(async (tx) => {
    const guestCart = await cartRepository.findOne({ where: { cartToken }, lean: true, skipThrowError: true });
    if (!guestCart) return tx.complete(NOT_MERGED);

    const guestLines = await cartLineRepository.findAll({ where: { cartId: guestCart._id }, sort: CART_LINE_ORDER, lean: true });
    const customerCart = await cartRepository.findOne({ where: { customerId: customerObjectId }, lean: true, skipThrowError: true });

    if (!customerCart) {
      await cartRepository.updateAtomic({ _id: guestCart._id }, { $set: { customerId: customerObjectId }, $unset: { cartToken: 1 } }, { skipThrowError: true });
      return tx.complete({ merged: true, lineCount: guestLines.length });
    }

    const customerLines = await cartLineRepository.findAll({ where: { cartId: customerCart._id }, sort: CART_LINE_ORDER, lean: true });
    const customerLineByIdentity = new Map(customerLines.map((line) => [identityOf(line.variantId, line.note), line]));

    // Sequential on purpose: one transaction session cannot run concurrent operations.
    for (const line of guestLines) {
      const existing = customerLineByIdentity.get(identityOf(line.variantId, line.note));
      if (existing) {
        await cartLineRepository.updateAtomic({ _id: existing._id }, { $inc: { quantity: line.quantity } }, { skipThrowError: true });
        await cartLineRepository.delete({ where: { _id: line._id }, skipThrowError: true });
      } else {
        await cartLineRepository.updateAtomic(
          { _id: line._id },
          { $set: { cartId: customerCart._id, lineIdentityKey: buildCartLineIdentityKey(customerCart._id, line.variantId, line.note) } },
          { skipThrowError: true }
        );
      }
    }

    const adopted: Record<string, unknown> = {};
    if (!customerCart.fulfilmentDraft && guestCart.fulfilmentDraft) adopted.fulfilmentDraft = guestCart.fulfilmentDraft;
    if (!customerCart.appliedPromotionCode && guestCart.appliedPromotionCode) adopted.appliedPromotionCode = guestCart.appliedPromotionCode;
    if (Object.keys(adopted).length > 0) {
      await cartRepository.updateAtomic({ _id: customerCart._id }, { $set: adopted }, { skipThrowError: true });
    }

    await cartRepository.delete({ where: { _id: guestCart._id }, skipThrowError: true });

    return tx.complete({ merged: true, lineCount: guestLines.length });
  });
}

/**
 * The sign-in wrapper: a failed merge must never fail the sign-in. The
 * transaction has already rolled back (the guest cart is intact), so the
 * customer simply keeps both carts and can try again next time.
 */
export async function mergeGuestCartOnSignIn(customerId: string, cartToken: string | null | undefined): Promise<CartMergeResult> {
  try {
    return await mergeGuestCart(customerId, cartToken);
  } catch (error) {
    console.error(`[cart-merge] merging the guest cart into customer ${customerId} failed; sign-in continues with the guest cart intact:`, error);
    return NOT_MERGED;
  }
}

function identityOf(variantId: mongoose.Types.ObjectId, note: string | undefined): string {
  return `${variantId.toString()}|${note ?? ""}`;
}
