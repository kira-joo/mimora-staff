import { MethodType, type Endpoint } from "@kira-joo/frontend-toolkit-core";
import type { StaffNotification } from "./notifications.endpoints";

/**
 * GET /admin/today. Every section is optional because the SERVER omits the ones the caller may not read —
 * absence means "not yours", never "zero". Money is a decimal string.
 */
export interface TodayData {
  /** The store's calendar date, `YYYY-MM-DD`. */
  storeDate: string;
  asOf: string;
  orders?: { placedToday: number; open: Array<{ status: string; count: number }> };
  payments?: { count: number; oldestWaitingHours: number | null };
  returns?: { requested: number; approved: number; received: number };
  stock?: { outOfStock: number; lowStock: number };
  sales?: { orderCount: number; grossSales: string; refunds: string; revenue: string };
  notifications?: { unread: number; recent: StaffNotification[] };
}

export const todayEndpoint: Endpoint<{ returnType: TodayData }> = {
  url: "/admin/today",
  methodType: MethodType.GET,
};
