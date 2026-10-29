import { AppPermission, CustomPermission } from "../../../common/authorization/authorization-registry";
import type { OrderStatus } from "../order-state/order-state.types";

/**
 * The Today screen's panels and who may see each. The server uses this to
 * OMIT a section the caller cannot read — not to send it and have the page
 * hide it — so a figure never leaves the backend for someone without the
 * permission that guards it. (`Report.read` for revenue: "sales figures are not
 * implied by order access".)
 */
export const TODAY_SECTIONS = ["orders", "payments", "returns", "stock", "sales", "notifications"] as const;
export type TodaySection = (typeof TODAY_SECTIONS)[number];

export const TODAY_SECTION_PERMISSION: Readonly<Record<TodaySection, string>> = {
  orders: AppPermission.ORDER.READ,
  payments: CustomPermission.PAYMENT_VERIFY,
  returns: AppPermission.RETURN.READ,
  stock: AppPermission.VARIANT.READ,
  sales: CustomPermission.REPORT_READ,
  notifications: CustomPermission.NOTIFICATION_READ,
};

/** Every permission that unlocks at least one panel — the route's `auth.permissions` (any of). */
export const TODAY_PERMISSIONS: readonly string[] = [...new Set(Object.values(TODAY_SECTION_PERMISSION))];

export function todaySectionsFor(can: (permission: string) => boolean): TodaySection[] {
  return TODAY_SECTIONS.filter((section) => can(TODAY_SECTION_PERMISSION[section]));
}

/** Statuses an order ends in. An order in any other status still needs someone to move it. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ["DELIVERED", "COLLECTED", "CANCELLED"];

/** Open statuses in lifecycle order — how the panel lists them. */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ["PLACED", "CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "IN_TRANSIT"];

/**
 * Orders still open, by status: every known open status (zero when none, so
 * the panel's shape is stable), in lifecycle order, then any other non-terminal
 * status a later release adds — never silently dropped.
 */
export function openOrderCounts(grouped: ReadonlyArray<{ status: string; count: number }>): Array<{ status: string; count: number }> {
  const byStatus = new Map(grouped.filter((row) => !(TERMINAL_ORDER_STATUSES as readonly string[]).includes(row.status)).map((row) => [row.status, row.count]));
  const known = OPEN_ORDER_STATUSES.map((status) => ({ status: status as string, count: byStatus.get(status) ?? 0 }));
  const extra = [...byStatus].filter(([status]) => !(OPEN_ORDER_STATUSES as readonly string[]).includes(status)).map(([status, count]) => ({ status, count }));
  return [...known, ...extra];
}
