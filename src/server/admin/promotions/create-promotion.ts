import { ConflictError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedString, Money } from "@kira-joo/toolkit-common";
import { promotionRepository } from "../../core/repositories";
import { normaliseCode, resolvePromotionValue } from "./promotion-value";
import type { PromotionSchema } from "../../commerce/promotion.schema";

export interface CreatePromotionInput {
  code?: string;
  name: LocalizedString;
  description: LocalizedString;
  type: "PERCENT" | "FIXED" | "FREE_SHIPPING";
  /** A decimal; required for PERCENT and FIXED, ignored for FREE_SHIPPING. */
  value?: Money;
  conditions: {
    minSubtotal?: Money;
    categories?: string[];
    collections?: string[];
    products?: string[];
    variants?: string[];
    firstOrderOnly?: boolean;
    startsAt?: Date;
    endsAt?: Date;
  };
  limits?: { totalUses?: number; perCustomerUses?: number };
  stackable?: boolean;
  active?: boolean;
}

/** `code` is uppercased at the schema level, so uniqueness is checked case-insensitively via the same uppercased form. */
export async function createPromotion(input: CreatePromotionInput): Promise<PromotionSchema> {
  const value = resolvePromotionValue(input.type, input.value);
  const code = normaliseCode(input.code);

  if (code) {
    const existing = await promotionRepository.findOne({ where: { code: code.toUpperCase() }, skipThrowError: true });
    if (existing) {
      throw new ConflictError("Promotion code already exists");
    }
  }

  return promotionRepository.save({
    code,
    name: input.name,
    description: input.description,
    type: input.type,
    value,
    conditions: {
      minSubtotal: input.conditions.minSubtotal,
      categories: input.conditions.categories ?? [],
      collections: input.conditions.collections ?? [],
      products: input.conditions.products ?? [],
      variants: input.conditions.variants ?? [],
      firstOrderOnly: input.conditions.firstOrderOnly ?? false,
      startsAt: input.conditions.startsAt,
      endsAt: input.conditions.endsAt,
    },
    limits: input.limits ?? {},
    stackable: input.stackable ?? false,
    active: input.active ?? true,
  });
}
