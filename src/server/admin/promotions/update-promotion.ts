import { ConflictError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedString, Money } from "@kira-joo/toolkit-common";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { promotionRepository } from "../../core/repositories";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";
import { lockCategoriesForAssignment } from "../categories/category-hierarchy";
import type { PromotionSchema } from "../../commerce/promotion.schema";
import { mergeOptional, type Patch } from "../../core/update/optional-update";
import { normaliseCode, resolvePromotionValue } from "./promotion-value";

/**
 * An update, field by field: omitted leaves the stored value, `null` clears
 * an optional one, anything else sets it (see `mergeOptional`). The scope
 * arrays and flags are always values; the optional ones — code, value, the
 * minimum, the dates and each limit — can be cleared.
 */
export interface UpdatePromotionInput {
  code?: string | null;
  name?: LocalizedString;
  description?: LocalizedString;
  type?: "PERCENT" | "FIXED" | "FREE_SHIPPING";
  value?: Money | null;
  conditions?: Patch<{
    minSubtotal?: Money;
    categories?: string[];
    collections?: string[];
    products?: string[];
    variants?: string[];
    firstOrderOnly?: boolean;
    startsAt?: Date;
    endsAt?: Date;
  }>;
  limits?: Patch<{ totalUses?: number; perCustomerUses?: number }>;
  stackable?: boolean;
  active?: boolean;
}

/**
 * In a transaction: a category this update newly limits the promotion to is written first
 * (`lockCategoriesForAssignment`) — it must exist (404 otherwise) and can't be deleted before this commits.
 */
export async function updatePromotion(promotionId: string, input: UpdatePromotionInput): Promise<PromotionSchema> {
  return withTransaction(async (tx) => {
    // The loser of a conflict must still be standing when the winner commits, or its retry budget burns in milliseconds.
    await backOffBeforeRetry(tx.attempt);
    const promotion = await promotionRepository.findOne({ where: { _id: promotionId } });

    const type = input.type ?? promotion.type;
    const storedValue = promotion.value ?? undefined;
    const value = resolvePromotionValue(type, input.value === undefined ? storedValue : (input.value ?? undefined));

    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ""> = {};

    if (input.code !== undefined) {
      const code = normaliseCode(input.code);
      if (code && code.toUpperCase() !== promotion.code) {
        const existing = await promotionRepository.findOne({ where: { code: code.toUpperCase(), _id: { $ne: promotionId } }, skipThrowError: true });
        if (existing) {
          throw new ConflictError("Promotion code already exists");
        }
      }
      if (code) $set.code = code;
      else $unset.code = "";
    }

    if (value === undefined) {
      if (storedValue !== undefined) $unset.value = "";
    } else if (input.value !== undefined || input.type !== undefined) {
      $set.value = value;
    }

    if (input.name !== undefined) $set.name = input.name;
    if (input.description !== undefined) $set.description = input.description;
    if (input.type !== undefined) $set.type = input.type;
    if (input.conditions !== undefined) {
      const conditions = mergeOptional<Record<string, unknown>>(promotion.conditions, input.conditions);
      $set.conditions = conditions;
      // Only categories this write ADDS need locking: removing a reference cannot dangle, and one already stored was locked when it was.
      const already = new Set((promotion.conditions?.categories ?? []).map(String));
      const added = ((conditions.categories as unknown[] | undefined) ?? []).map(String).filter((categoryId) => !already.has(categoryId));
      await lockCategoriesForAssignment(added);
    }
    if (input.limits !== undefined) $set.limits = mergeOptional<Record<string, unknown>>(promotion.limits, input.limits);
    if (input.stackable !== undefined) $set.stackable = input.stackable;
    if (input.active !== undefined) $set.active = input.active;

    const updated = await promotionRepository.updateAtomic({ _id: promotionId }, { $set, ...(Object.keys($unset).length ? { $unset } : {}) });
    return tx.complete(updated);
  }, { maxRetries: CONTENDED_MAX_RETRIES });
}
