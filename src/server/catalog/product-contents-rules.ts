import mongoose from "mongoose";

/** More than this stops reading as "what's inside" a box and starts reading as a catalogue. */
export const MAX_CONTENT_ITEMS = 20;
export const MIN_CONTENT_QUANTITY = 1;
export const MAX_CONTENT_QUANTITY = 99;

export interface ContentItemInput {
  productId: string;
  quantity: number;
}

/**
 * Why a contents list cannot be saved — empty when it can. A product cannot contain itself, is listed once (raise its
 * quantity instead), has a whole quantity within bounds, and the list is not unbounded. Nesting (an included product
 * that itself has contents) is allowed: only one level is ever shown, so self-inclusion is the only possible cycle.
 */
export function contentsProblems(boxId: string, items: ContentItemInput[]): string[] {
  const problems: string[] = [];
  if (items.length > MAX_CONTENT_ITEMS) problems.push(`A product can list at most ${MAX_CONTENT_ITEMS} included products.`);

  const seen = new Set<string>();
  items.forEach((item, index) => {
    const position = `Item ${index + 1}`;
    const productId = typeof item.productId === "string" ? item.productId.trim() : "";
    if (!productId || !mongoose.isValidObjectId(productId) || productId.length !== 24) {
      problems.push(`${position} is not a valid product.`);
    } else if (productId === boxId.trim()) {
      problems.push(`${position} is the product itself — a product cannot contain itself.`);
    } else if (seen.has(productId)) {
      problems.push(`${position} is already listed — raise its quantity instead.`);
    }
    if (productId) seen.add(productId);

    if (!Number.isInteger(item.quantity) || item.quantity < MIN_CONTENT_QUANTITY || item.quantity > MAX_CONTENT_QUANTITY) {
      problems.push(`${position} needs a whole quantity from ${MIN_CONTENT_QUANTITY} to ${MAX_CONTENT_QUANTITY}.`);
    }
  });
  return problems;
}
