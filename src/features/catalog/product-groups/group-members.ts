import type { LocalizedText } from "src/api/brands.endpoints";
import type { ProductGroup, ProductGroupMember, ProductGroupMemberInput } from "src/api/product-groups.endpoints";

/** A row in the members editor: what is saved, plus what staff need to recognise the product. */
export type MemberRow = Pick<ProductGroupMember, "productId" | "name" | "slug" | "lifecycle" | "image" | "label"> & {
  /** Set when the product is in ANOTHER group now — saving moves it here. */
  movesFrom?: string;
};

export const rowsOf = (group: ProductGroup): MemberRow[] => group.members.map(({ productId, name, slug, lifecycle, image, label }) => ({ productId, name, slug, lifecycle, image, label: { ...label } }));

/** What the members PUT sends: ids and labels, in display order. */
export const toInputs = (rows: MemberRow[]): ProductGroupMemberInput[] => rows.map((row) => ({ productId: row.productId, label: { en: row.label.en, ar: row.label.ar } }));

/** Moves one row up (-1) or down (+1); out-of-range moves return the list unchanged. */
export function moveRow<T>(rows: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** Appends a product (once); a product already listed is left where it is. */
export function addRow(rows: MemberRow[], row: MemberRow): MemberRow[] {
  return rows.some((existing) => existing.productId === row.productId) ? rows : [...rows, row];
}

/**
 * The membership a product page saves to put ONE product into `group` with `label`: kept in place with the new label
 * if it is already a member, otherwise appended last. Every other member is sent back exactly as loaded.
 */
export function withProduct(group: ProductGroup, productId: string, label: LocalizedText): ProductGroupMemberInput[] {
  const inputs = toInputs(rowsOf(group));
  const index = inputs.findIndex((input) => input.productId === productId);
  if (index >= 0) return inputs.map((input, i) => (i === index ? { productId, label } : input));
  return [...inputs, { productId, label }];
}

/** The membership a product page saves to take ONE product out of `group`. */
export const withoutProduct = (group: ProductGroup, productId: string): ProductGroupMemberInput[] => toInputs(rowsOf(group)).filter((input) => input.productId !== productId);

/** True when the editor's rows differ from what is saved (order, members or labels). */
export function membersChanged(rows: MemberRow[], group: ProductGroup): boolean {
  return JSON.stringify(toInputs(rows)) !== JSON.stringify(toInputs(rowsOf(group)));
}
