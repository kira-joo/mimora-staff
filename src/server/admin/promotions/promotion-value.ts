import { BadRequestError, ConflictError } from "@kira-joo/backend-toolkit-core";
import { toMoney, type Money } from "@kira-joo/toolkit-common";
import type { PromotionSchema } from "../../commerce/promotion.schema";

type PromotionType = PromotionSchema["type"];

const HUNDRED = toMoney(100);

/**
 * The value a promotion of `type` keeps, or the reason it can't be saved.
 * PERCENT and FIXED need one (zero is a value, not its absence); a PERCENT
 * cannot exceed 100; FREE_SHIPPING has none — a stored value is dropped when
 * a promotion becomes free shipping, never left behind to mislead.
 */
export function resolvePromotionValue(type: PromotionType, value: Money | undefined): Money | undefined {
  if (type === "FREE_SHIPPING") return undefined;
  if (value === undefined) throw new BadRequestError(`A ${type} promotion needs a value.`);
  if (type === "PERCENT" && value.greaterThan(HUNDRED)) throw new ConflictError("A PERCENT promotion's value cannot exceed 100.");
  return value;
}

/** An empty or whitespace code is no code — the promotion applies automatically. */
export const normaliseCode = (code: string | null | undefined): string | undefined => (code && code.trim() ? code.trim() : undefined);
