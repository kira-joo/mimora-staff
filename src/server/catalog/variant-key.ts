/**
 * Canonically-ordered derived key enforcing "exactly one variant per axis
 * combination" — see `variant.schema.ts`'s `variantKey` field doc comment.
 * Format: `<productId>|colour=red|size=m`, option values sorted by key so
 * the same combination always produces the same string regardless of the
 * order a caller submits them in.
 */
export function buildVariantKey(productId: string, optionValues: Array<{ key: string; value: string }>): string {
  const parts = [...optionValues]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((ov) => `${ov.key}=${ov.value}`);

  return [productId, ...parts].join("|");
}
