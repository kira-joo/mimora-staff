import { MethodType, type Endpoint } from "@kira-joo/frontend-toolkit-core";
import type { PaymentAgeingBand } from "src/server/engines/reports/payment-ageing";
import type { InventoryItem } from "./inventory.endpoints";

export type SalesGranularity = "day" | "month";

/** One period of `GET /admin/reports/sales-summary`. Money is decimal strings; revenue = sales − refunds, each in the period it happened. */
export interface SalesPeriod {
  /** `YYYY-MM-DD` (day) or `YYYY-MM` (month), in the store's time zone. */
  period: string;
  orderCount: number;
  grossSales: string;
  refunds: string;
  revenue: string;
  averageOrderValue: string;
}

export interface SalesSummary {
  granularity: SalesGranularity;
  from: string;
  to: string;
  periods: SalesPeriod[];
  totals: Omit<SalesPeriod, "period">;
}

export interface SalesSummaryQuery {
  granularity?: SalesGranularity;
  /** Inclusive store-local `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  [key: string]: unknown;
}

export interface StockHealthItem extends InventoryItem {
  health: "OUT_OF_STOCK" | "LOW_STOCK";
  effectiveThreshold: number;
}

export interface StockHealthReport {
  data: StockHealthItem[];
  total: number;
  defaultThreshold: number;
  outOfStockCount: number;
  lowStockCount: number;
}

export interface PaymentAgeingReport {
  asOf: string;
  count: number;
  oldestWaitingHours: number | null;
  bands: Array<{ band: PaymentAgeingBand; count: number }>;
  items: Array<{ orderId: string; orderNumber: string; method: string; expectedAmount: string; waitingSince: string; waitingHours: number; band: PaymentAgeingBand }>;
}

const REPORTS = "/admin/reports";

export const salesSummaryEndpoint: Endpoint<{ query: SalesSummaryQuery; returnType: SalesSummary }> = {
  url: `${REPORTS}/sales-summary`,
  methodType: MethodType.GET,
};

export const stockHealthEndpoint: Endpoint<{ query: { page?: number; limit?: number; [key: string]: unknown }; returnType: StockHealthReport }> = {
  url: `${REPORTS}/stock-health`,
  methodType: MethodType.GET,
};

export const paymentAgeingEndpoint: Endpoint<{ returnType: PaymentAgeingReport }> = {
  url: `${REPORTS}/payment-ageing`,
  methodType: MethodType.GET,
};
