import type { ReturnLine } from "src/api/returns.endpoints";
import { MONEY_INPUT_PATTERN } from "src/common/format/money-input";

/** Same shape the API's DTO accepts: a non-negative decimal with at most two places. */

/** Input-shape check only — whether the amount fits the order's refundable remainder is the server's call (409). */
export function refundAmountError(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return "Enter the amount that was refunded.";
  if (!MONEY_INPUT_PATTERN.test(value)) return "Use a decimal amount like 120.00.";
  if (/^0+(\.0+)?$/.test(value)) return "The amount must be greater than zero.";
  return undefined;
}

/** Lines the server will still accept in a receive call — those with no disposition yet. */
export const receivableLines = (lines: ReturnLine[]): ReturnLine[] => lines.filter((line) => !line.disposition);

/** The field error for each received line whose inspected condition is blank — keyed by return line id; empty when all are given. The server enforces it too. */
export function inspectedConditionErrors(lines: { id: string; inspectedCondition: string }[]): Record<string, string> {
  return Object.fromEntries(lines.filter((line) => !line.inspectedCondition.trim()).map((line) => [line.id, "Record the condition you found."]));
}
