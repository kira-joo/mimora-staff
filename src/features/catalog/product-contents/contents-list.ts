import type { ProductContentItem } from "src/api/product-contents.endpoints";
import { MAX_CONTENT_ITEMS, MAX_CONTENT_QUANTITY } from "src/api/product-contents.endpoints";

export type ContentRow = Pick<ProductContentItem, "productId" | "name" | "slug" | "lifecycle" | "image"> & { quantity: string };

export const rowsOfContents = (items: ProductContentItem[]): ContentRow[] => items.map(({ quantity, ...rest }) => ({ ...rest, quantity: String(quantity) }));

/** What the PUT sends. */
export const contentsBody = (rows: ContentRow[]) => ({ items: rows.map((row) => ({ productId: row.productId, quantity: Number(row.quantity) })) });

/** Why the list can't be saved (the server checks the same and more), or an empty list. */
export function contentRowProblems(boxId: string, rows: ContentRow[]): string[] {
  const problems: string[] = [];
  if (rows.length > MAX_CONTENT_ITEMS) problems.push(`A product can list at most ${MAX_CONTENT_ITEMS} included products.`);
  rows.forEach((row, index) => {
    const quantity = Number(row.quantity);
    if (!/^\d+$/.test(row.quantity.trim()) || quantity < 1 || quantity > MAX_CONTENT_QUANTITY) problems.push(`Item ${index + 1}: the quantity must be a whole number from 1 to ${MAX_CONTENT_QUANTITY}.`);
    if (row.productId === boxId) problems.push(`Item ${index + 1}: a product cannot contain itself.`);
  });
  return problems;
}

export const sameContents = (rows: ContentRow[], items: ProductContentItem[]) => JSON.stringify(contentsBody(rows)) === JSON.stringify(contentsBody(rowsOfContents(items)));
