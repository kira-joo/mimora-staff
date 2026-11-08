import { ConflictError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedString, Money } from "@kira-joo/toolkit-common";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { promotionRepository } from "../../core/repositories";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";
import { lockCategoriesForAssignment } from "../categories/category-hierarchy";
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

/**
 * `code` is uppercased at the schema level, so uniqueness is checked case-insensitively via the same uppercased form.
 *
 * In a transaction that first writes every category the promotion is limited to (`lockCategoriesForAssignment`): each
 * must exist (404 otherwise), and the promotion can't commit beside a concurrent `deleteCategory`, which counts
 * promotions by `conditions.categories` but would otherwise never conflict with this insert.
 */
export async function createPromotion(input: CreatePromotionInput): Promise<PromotionSchema> {
  const value = resolvePromotionValue(input.type, input.value);
  const code = normaliseCode(input.code);

  return withTransaction(async (tx) => {
    // The loser of a conflict must still be standing when the winner commits, or its retry budget burns in milliseconds.
    await backOffBeforeRetry(tx.attempt);
    if (code) {
      const existing = await promotionRepository.findOne({ where: { code: code.toUpperCase() }, skipThrowError: true });
      if (existing) {
        throw new ConflictError("Promotion code already exists");
      }
    }
    await lockCategoriesForAssignment(input.conditions.categories ?? []);

    const created = await promotionRepository.save({
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
    return tx.complete(created);
  }, { maxRetries: CONTENDED_MAX_RETRIES });
}
