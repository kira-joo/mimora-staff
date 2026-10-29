import { MONEY_INPUT_MESSAGE, MONEY_INPUT_PATTERN } from "src/common/format/money-input";
import type { Promotion, PromotionInput, PromotionType } from "src/api/promotions.endpoints";

export interface PromotionFormValues {
  name: { ar: string; en: string };
  description: { ar: string; en: string };
  code: string;
  type: PromotionType;
  /** As typed. Ignored for FREE_SHIPPING. */
  value: string;
  minSubtotal: string;
  firstOrderOnly: boolean;
  categories: string[];
  collections: string[];
  products: string[];
  /** Not editable here (no global variant search exists); kept so a save never drops them. */
  variants: string[];
  /** ISO instants; "" when unset. */
  startsAt: string;
  endsAt: string;
  totalUses: string;
  perCustomerUses: string;
  active: boolean;
}

const EMPTY_TEXT = { ar: "", en: "" };

/** API shape → form values; no promotion → the create defaults. */
export function mapPromotionToFormValues(oldData?: Promotion): PromotionFormValues {
  return {
    name: oldData?.name ?? EMPTY_TEXT,
    description: oldData?.description ?? EMPTY_TEXT,
    code: oldData?.code ?? "",
    type: oldData?.type ?? "PERCENT",
    value: oldData?.value ?? "",
    minSubtotal: oldData?.conditions.minSubtotal ?? "",
    firstOrderOnly: oldData?.conditions.firstOrderOnly ?? false,
    categories: oldData?.conditions.categories ?? [],
    collections: oldData?.conditions.collections ?? [],
    products: oldData?.conditions.products ?? [],
    variants: oldData?.conditions.variants ?? [],
    startsAt: oldData?.conditions.startsAt ?? "",
    endsAt: oldData?.conditions.endsAt ?? "",
    totalUses: oldData?.limits?.totalUses != null ? String(oldData.limits.totalUses) : "",
    perCustomerUses: oldData?.limits?.perCustomerUses != null ? String(oldData.limits.perCustomerUses) : "",
    active: oldData?.active ?? true,
  };
}

const blank = (text: unknown): boolean => text === undefined || text === null || String(text).trim() === "";

/** Mirrors the backend: PERCENT 0-100, FIXED a money amount. Returns the message, or undefined when fine. */
export function discountValueProblem(type: PromotionType, raw: unknown): string | undefined {
  if (type === "FREE_SHIPPING") return undefined;
  if (blank(raw)) return "Required";
  const text = String(raw).trim();
  if (!MONEY_INPUT_PATTERN.test(text)) return type === "PERCENT" ? "Enter a percentage like 15 or 12.5." : MONEY_INPUT_MESSAGE;
  if (type === "PERCENT" && Number(text) > 100) return "A percentage cannot exceed 100.";
  return undefined;
}

export function minSubtotalProblem(raw: unknown): string | undefined {
  return blank(raw) || MONEY_INPUT_PATTERN.test(String(raw).trim()) ? undefined : MONEY_INPUT_MESSAGE;
}

/** Blank is "no limit" (on an edit it clears a stored one); otherwise a whole number, 1 or more — the DTO's minimum. */
export function limitProblem(raw: unknown): string | undefined {
  if (blank(raw)) return undefined;
  const text = String(raw).trim();
  return /^\d+$/.test(text) && Number(text) >= 1 ? undefined : "Enter a whole number, 1 or more.";
}

/** Blank is "no code": the promotion applies automatically (on an edit it removes a stored code). */
export function codeProblem(raw: unknown): string | undefined {
  return blank(raw) || String(raw).trim().length <= 50 ? undefined : "At most 50 characters.";
}

export function dateWindowProblem(startsAt: string, endsAt: string): string | undefined {
  return startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt) ? "The end must be after the start." : undefined;
}

/**
 * Form values → the request body. A blank optional field is omitted on a
 * create and sent as `null` on an edit, which the API reads as "clear it" —
 * so emptying a code, a limit, the minimum or a date really removes it.
 * Tolerates empty numeric fields arriving as undefined. The value stays a
 * decimal string; FREE_SHIPPING has none.
 */
export function promotionToBody(values: PromotionFormValues, isEdit: boolean): PromotionInput {
  const text = (v: unknown) => (blank(v) ? undefined : String(v).trim());
  const optional = (v: unknown) => text(v) ?? (isEdit ? null : undefined);
  const whole = (v: unknown) => {
    const present = text(v);
    return present === undefined ? (isEdit ? null : undefined) : Number(present);
  };
  const limits = { totalUses: whole(values.totalUses), perCustomerUses: whole(values.perCustomerUses) };
  return {
    code: optional(values.code),
    name: values.name,
    description: values.description,
    type: values.type,
    value: values.type === "FREE_SHIPPING" ? (isEdit ? null : undefined) : text(values.value),
    conditions: {
      minSubtotal: optional(values.minSubtotal),
      categories: values.categories,
      collections: values.collections,
      products: values.products,
      variants: values.variants,
      firstOrderOnly: values.firstOrderOnly,
      startsAt: optional(values.startsAt),
      endsAt: optional(values.endsAt),
    },
    limits,
    active: values.active,
  };
}
