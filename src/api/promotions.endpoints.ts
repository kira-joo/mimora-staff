import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";
import type { LocalizedText } from "./brands.endpoints";

export type PromotionType = "PERCENT" | "FIXED" | "FREE_SHIPPING";

export interface PromotionConditions {
  /** Money: a decimal string in major units. */
  minSubtotal?: string;
  categories: string[];
  collections: string[];
  products: string[];
  variants: string[];
  firstOrderOnly: boolean;
  /** ISO instants. */
  startsAt?: string;
  endsAt?: string;
}

export interface PromotionLimits {
  totalUses?: number;
  perCustomerUses?: number;
}

export interface Promotion {
  _id: string;
  /** Absent means an automatic promotion (no code to enter). */
  code?: string;
  name: LocalizedText;
  description: LocalizedText;
  type: PromotionType;
  /** An exact decimal string: a percentage 0-100 for PERCENT, major units for FIXED; absent for FREE_SHIPPING. */
  value?: string;
  conditions: PromotionConditions;
  /** Absent when no limit was ever set (an empty object is not stored). */
  limits?: PromotionLimits;
  usageCount: number;
  stackable: boolean;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * `stackable` is deliberately not sent: the engine ignores it in v1, and an
 * update leaves the stored value alone. On an update, `null` clears an
 * optional field (code, value, the minimum, a date, a limit); omitting it
 * leaves it as it is.
 */
export interface PromotionInput {
  code?: string | null;
  name: LocalizedText;
  description: LocalizedText;
  type: PromotionType;
  value?: string | null;
  conditions: {
    minSubtotal?: string | null;
    categories?: string[];
    collections?: string[];
    products?: string[];
    variants?: string[];
    firstOrderOnly?: boolean;
    startsAt?: string | null;
    endsAt?: string | null;
  };
  limits?: { totalUses?: number | null; perCustomerUses?: number | null };
  active?: boolean;
}

export interface ListPromotionsQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  active?: boolean;
  type?: PromotionType;
  [key: string]: unknown;
}

const PROMOTIONS = "/admin/promotions";

export const listPromotionsEndpoint: Endpoint<{ query: ListPromotionsQuery; returnType: PaginatedResponse<Promotion> }> = {
  url: PROMOTIONS,
  methodType: MethodType.GET,
};

export const getPromotionEndpoint: Endpoint<{ params: { id: string }; returnType: Promotion }> = {
  url: `${PROMOTIONS}/:id`,
  methodType: MethodType.GET,
};

export const createPromotionEndpoint: Endpoint<{ body: PromotionInput; returnType: Promotion }> = {
  url: PROMOTIONS,
  methodType: MethodType.POST,
};

export const updatePromotionEndpoint: Endpoint<{ params: { id: string }; body: Partial<PromotionInput>; returnType: Promotion }> = {
  url: `${PROMOTIONS}/:id`,
  methodType: MethodType.PUT,
};

/** The API's DELETE deactivates (`active: false`); the record and its usage count stay. */
export const deactivatePromotionEndpoint: Endpoint<{ params: { id: string }; returnType: void }> = {
  url: `${PROMOTIONS}/:id`,
  methodType: MethodType.DELETE,
};
