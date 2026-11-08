/** `CreateProductDto.slug` is `@MaxLength(200)`; a suffixed slug must still fit. */
export const MAX_PRODUCT_SLUG_LENGTH = 200;

/**
 * The first free slug for `base` among `taken`: `base` itself when free, else `base-2`, `base-3`, … — one past the
 * highest suffix in use, so a deleted `-2` is not reused while `-3` still exists. The base is cut (at a word
 * boundary's dash when one is close) so the suffixed result still fits `MAX_PRODUCT_SLUG_LENGTH`.
 */
export function nextFreeSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;

  const suffixed = new RegExp(`^${escape(base)}-(\\d+)$`);
  let highest = 1;
  for (const slug of used) {
    const match = suffixed.exec(slug);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  const suffix = `-${highest + 1}`;
  const room = MAX_PRODUCT_SLUG_LENGTH - suffix.length;
  const stem = base.length > room ? base.slice(0, room).replace(/-+$/, "") : base;
  return `${stem}${suffix}`;
}

/** Every stored slug that `nextFreeSlug(base, …)` must see: `base` and `base-<n>`. */
export function slugFamilyPattern(base: string): RegExp {
  return new RegExp(`^${escape(base)}(-\\d+)?$`);
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
