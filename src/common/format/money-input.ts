/**
 * A money amount as staff type it: major units, up to two decimals, no sign,
 * no grouping. **The one definition** — every admin DTO and the catalog CSV
 * import validate with this same pattern. Money stays a string end to end; the
 * client never parses it into a float.
 *
 * At most 13 digits before the point (below 10,000,000,000,000): money is stored
 * as a BSON Double, which holds a two-decimal amount exactly only up to 15
 * significant digits. A larger amount is refused here — a field error, a 400 —
 * rather than stored with its cents silently dropped. The storage setter
 * (`moneyDoubleField`) refuses the same range as a last guard.
 */
export const MONEY_INPUT_PATTERN = /^\d{1,13}(\.\d{1,2})?$/;

export const MONEY_INPUT_MESSAGE = "Enter an amount like 250 or 249.99 (at most 13 digits before the point).";

export const isMoneyInput = (value: string): boolean => MONEY_INPUT_PATTERN.test(value.trim());
