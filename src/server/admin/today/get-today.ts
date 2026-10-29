import { hasPermission } from "@kira-joo/frontend-toolkit-core/server";
import { sanitizeLeanResult } from "@kira-joo/backend-toolkit-mongoose";
import { OrderModel } from "../../commerce/order.schema";
import { storeTimeZone } from "../../core/config/store-timezone";
import { inventorySettingsRepository, orderRepository, returnRepository, variantRepository } from "../../core/repositories";
import { atOrBelowThresholdFilter } from "../../engines/reports/stock-health";
import { addDays, startOfZonedDate, zonedDate } from "../../engines/reports/zoned-calendar";
import { TERMINAL_ORDER_STATUSES, openOrderCounts, todaySectionsFor } from "../../engines/today/today-sections";
import type { ListNotificationsQueryDto } from "../dto/list-notifications-query.dto";
import { getPaymentAgeing } from "../reports/get-payment-ageing";
import { getSalesSummary } from "../reports/get-sales-summary";
import { getSingletonSettings } from "../settings/singleton-settings";
import { countUnreadStaffNotifications, listStaffNotifications, type NotificationReader, type StaffNotificationView } from "../notifications/staff-notifications";

export interface TodayView {
  /** The store's calendar date the figures are for, `YYYY-MM-DD` in `STORE_TIMEZONE`. */
  storeDate: string;
  asOf: Date;
  /** Every section is present only if the caller may read it. */
  orders?: { placedToday: number; open: Array<{ status: string; count: number }> };
  payments?: { count: number; oldestWaitingHours: number | null };
  returns?: { requested: number; approved: number; received: number };
  stock?: { outOfStock: number; lowStock: number };
  /** Revenue is net of refunds, each in the period it happened — the sales report's own definition. Money as decimal strings on the wire. */
  sales?: { orderCount: number; grossSales: unknown; refunds: unknown; revenue: unknown };
  notifications?: { unread: number; recent: StaffNotificationView[] };
}

const RECENT_NOTIFICATIONS = 5;

/**
 * The operational landing page: what needs doing right now. Aggregates the
 * store day (`STORE_TIMEZONE`) and, for each panel, runs ONLY if the caller
 * holds the permission that guards it — so a figure the caller may not see is
 * never computed, never serialised, and absent from the response (not null,
 * not zero: absent).
 *
 * Reuses the reports' own functions for payment ageing, stock-health filter
 * and sales, so Today and Reports cannot disagree about the same number.
 */
export async function getToday(reader: NotificationReader, now: Date): Promise<TodayView> {
  const sections = new Set(todaySectionsFor((permission) => hasPermission(reader, permission)));
  const timeZone = storeTimeZone();
  const storeDate = zonedDate(now, timeZone);
  const view: TodayView = { storeDate, asOf: now };

  if (sections.has("orders")) {
    const dayStart = startOfZonedDate(storeDate, timeZone);
    const dayEnd = startOfZonedDate(addDays(storeDate, 1), timeZone);
    const placedToday = await orderRepository.count({ where: { placedAt: { $gte: dayStart, $lt: dayEnd }, status: { $ne: "CANCELLED" } } });
    // An aggregate: grouping by status has no repository equivalent.
    const grouped: Array<{ _id: string; count: number }> = sanitizeLeanResult(
      await OrderModel.aggregate([{ $match: { status: { $nin: [...TERMINAL_ORDER_STATUSES] } } }, { $group: { _id: "$status", count: { $sum: 1 } } }])
    );
    view.orders = { placedToday, open: openOrderCounts(grouped.map((g) => ({ status: g._id, count: g.count }))) };
  }

  if (sections.has("payments")) {
    const ageing = await getPaymentAgeing(now);
    view.payments = { count: ageing.count, oldestWaitingHours: ageing.oldestWaitingHours };
  }

  if (sections.has("returns")) {
    view.returns = {
      requested: await returnRepository.count({ where: { status: "REQUESTED" } }),
      approved: await returnRepository.count({ where: { status: "APPROVED" } }),
      received: await returnRepository.count({ where: { status: "RECEIVED" } }),
    };
  }

  if (sections.has("stock")) {
    const { lowStockThreshold } = await getSingletonSettings(inventorySettingsRepository);
    const active = { discontinued: false };
    const outOfStock = await variantRepository.count({ where: { ...active, stock: { $lte: 0 } } });
    const atOrBelow = await variantRepository.count({ where: { ...active, ...atOrBelowThresholdFilter(lowStockThreshold) } });
    view.stock = { outOfStock, lowStock: atOrBelow - outOfStock };
  }

  if (sections.has("sales")) {
    const summary = await getSalesSummary({ granularity: "day", from: storeDate, to: storeDate, now });
    view.sales = { orderCount: summary.totals.orderCount, grossSales: summary.totals.grossSales, refunds: summary.totals.refunds, revenue: summary.totals.revenue };
  }

  if (sections.has("notifications")) {
    const recent = await listStaffNotifications(reader, { page: 1, limit: RECENT_NOTIFICATIONS } as ListNotificationsQueryDto);
    view.notifications = { unread: await countUnreadStaffNotifications(reader), recent: recent.data };
  }

  return view;
}
