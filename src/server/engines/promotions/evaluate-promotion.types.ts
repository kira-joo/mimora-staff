import type { Money } from "@kira-joo/toolkit-common";
import type { AppliedDiscount } from "../pricing/pricing.types";

/** Mirrors `PromotionSchema.type` exactly (`commerce/promotion.schema.ts`). */
export type PromotionType = "PERCENT" | "FIXED" | "FREE_SHIPPING";

/** Why a promotion does not apply. Surfaced verbatim so the customer knows what to change. */
export type PromotionRejection =
  | "INACTIVE"
  | "NOT_STARTED"
  | "EXPIRED"
  | "BELOW_MINIMUM"
  | "NOT_FIRST_ORDER"
  | "NO_ELIGIBLE_ITEMS"
  | "USAGE_LIMIT_REACHED"
  | "CUSTOMER_LIMIT_REACHED";

export interface EvaluablePromotion {
  type: PromotionType;
  /**
   * An exact decimal: a percentage 0–100 for PERCENT, major units for FIXED,
   * absent for FREE_SHIPPING. Absent on a PERCENT/FIXED promotion (which the
   * API refuses to save) discounts nothing rather than crashing.
   */
  value?: Money;
  active: boolean;
  conditions: {
    minSubtotal?: Money;
    /** Every array empty means "no restriction on that axis" — never "excludes everything". */
    categories: string[];
    collections: string[];
    products: string[];
    variants: string[];
    firstOrderOnly: boolean;
    startsAt?: Date;
    endsAt?: Date;
  };
  /** Absent means unlimited. A limit, when present, is at least 1 (the API's minimum). */
  limits: { totalUses?: number; perCustomerUses?: number };
  usageCount: number;
  stackable: boolean;
}

export interface PromotionContext {
  now: Date;
  subtotal: Money;
  /** One entry per cart line, for evaluating scoping conditions. */
  lines: {
    categoryId: string;
    collectionIds: string[];
    productId: string;
    variantId: string;
    lineTotal: Money;
  }[];
  isFirstOrder: boolean;
  /** How many times this customer has already used this promotion. */
  customerUses: number;
}

export type PromotionEvaluation =
  | { applicable: true; effect: AppliedDiscount; eligibleSubtotal: Money }
  | { applicable: false; rejection: PromotionRejection };
