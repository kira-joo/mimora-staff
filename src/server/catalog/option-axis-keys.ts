/**
 * Whether an option-axis update changes the product's set of axis keys —
 * adding, removing or renaming a key. Reordering axes or editing a display
 * name does not: MDS §8 makes axis keys immutable identifiers (every variant
 * stores one value per key, and `variantKey` is built from them) and display
 * names freely editable.
 */
export function axisKeysChanged(current: ReadonlyArray<{ key: string }>, next: ReadonlyArray<{ key: string }>): boolean {
  const before = new Set(current.map((axis) => axis.key));
  const after = new Set(next.map((axis) => axis.key));
  return before.size !== after.size || [...after].some((key) => !before.has(key));
}
