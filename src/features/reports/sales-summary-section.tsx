"use client";

import { createQueryParamSchema, queryParam, useQueryParamsState, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomButton, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomDatePicker } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { salesSummaryEndpoint, type SalesGranularity, type SalesSummary } from "src/api/reports.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { barShare, isNegative, periodLabel } from "./sales-display";

const FILTERS = createQueryParamSchema({
  granularity: queryParam.enum<SalesGranularity>(["day", "month"], { defaultValue: "day" }),
  from: queryParam.string(),
  to: queryParam.string(),
});

const GRANULARITIES: { value: SalesGranularity; label: string }[] = [
  { value: "day", label: "Daily" },
  { value: "month", label: "Monthly" },
];

/**
 * Revenue per day or month: sales of non-cancelled orders minus refunds, each
 * in the period it happened, in the store's time zone — the backend computes
 * every figure; this only lays them out. Filters live in the URL. Without
 * dates the API chooses its default range, and the range it used is shown.
 */
export function SalesSummarySection() {
  const [filters, setFilters, clearFilters] = useQueryParamsState(FILTERS);
  const granularity = filters.granularity ?? "day";
  const query = useRequesterQuery({
    endpoint: salesSummaryEndpoint,
    options: { query: { granularity, from: filters.from, to: filters.to } },
    // A refused range is shown in place; no second toast.
    queryOptions: { meta: { skipErrorToast: true } },
  });

  return (
    <section aria-labelledby="sales-heading" className="flex flex-col gap-4 rounded-md border border-[var(--st-line)] bg-[var(--st-surface)] p-4">
      <header className="flex flex-col gap-1">
        <h2 id="sales-heading" className="text-lg font-semibold">
          Sales
        </h2>
        <p className="text-[13px] text-[var(--st-ink-muted)]">Revenue is sales of non-cancelled orders minus refunds, each counted in the period it happened.</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Period" className="flex">
          {GRANULARITIES.map((option) => (
            <CustomButton
              key={option.value}
              type="button"
              variant={granularity === option.value ? "default" : "outline"}
              aria-pressed={granularity === option.value}
              className="first:rounded-e-none last:rounded-s-none"
              onClick={() => setFilters({ granularity: option.value })}
            >
              {option.label}
            </CustomButton>
          ))}
        </div>
        <CustomDatePicker label="From" value={filters.from ?? ""} onChange={(event) => setFilters({ from: event.target.value || undefined })} />
        <CustomDatePicker label="To" value={filters.to ?? ""} onChange={(event) => setFilters({ to: event.target.value || undefined })} />
        {filters.from || filters.to || filters.granularity !== "day" ? (
          <CustomButton type="button" variant="ghost" onClick={clearFilters}>
            Reset
          </CustomButton>
        ) : null}
      </div>

      <QueryState query={query} entityName="sales summary">
        {(summary) => <SalesTable summary={summary} />}
      </QueryState>
    </section>
  );
}

function SalesTable({ summary }: { summary: SalesSummary }) {
  const format = useStoreFormat();
  const revenues = summary.periods.map((period) => period.revenue);
  const money = (value: string) => <span className={isNegative(value) ? "text-[var(--st-status-danger)]" : undefined}>{format.money(value)}</span>;

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Revenue">{money(summary.totals.revenue)}</Figure>
        <Figure label="Orders">{summary.totals.orderCount}</Figure>
        <Figure label="Refunds">{format.money(summary.totals.refunds)}</Figure>
        <Figure label="Average order">{format.money(summary.totals.averageOrderValue)}</Figure>
      </dl>
      <p className="text-[13px] text-[var(--st-ink-muted)]">
        <span className="st-figure">{summary.from}</span> to <span className="st-figure">{summary.to}</span>, store time
      </p>
      <div className="overflow-x-auto rounded-md border border-[var(--st-line)]">
        <table className="w-full min-w-[44rem] border-collapse">
          <caption className="sr-only">Sales by {summary.granularity === "day" ? "day" : "month"}</caption>
          <thead>
            <tr className="text-[12px] uppercase tracking-wide text-[var(--st-ink-muted)]">
              <th scope="col" className="px-3 py-2 text-start font-semibold">
                {summary.granularity === "day" ? "Day" : "Month"}
              </th>
              <th scope="col" className="w-1/4 px-3 py-2 text-start font-semibold">
                <span className="sr-only">Revenue, relative</span>
              </th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">Orders</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">Sales</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">Refunds</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">Revenue</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold">Avg order</th>
            </tr>
          </thead>
          <tbody className="st-figure">
            {summary.periods.map((row) => (
              <tr key={row.period} className="border-t border-[var(--st-line)]">
                <th scope="row" className="whitespace-nowrap px-3 py-2 text-start font-medium">
                  {periodLabel(row.period, summary.granularity)}
                </th>
                <td className="px-3 py-2" aria-hidden="true">
                  <div className="h-2 rounded-full bg-[var(--st-accent)]" style={{ width: `${barShare(row.revenue, revenues) * 100}%` }} />
                </td>
                <td className="px-3 py-2 text-end">{row.orderCount}</td>
                <td className="whitespace-nowrap px-3 py-2 text-end">{format.money(row.grossSales)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-end text-[var(--st-ink-muted)]">{format.money(row.refunds)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-end font-medium">{money(row.revenue)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-end">{format.money(row.averageOrderValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--st-line)] px-3 py-2">
      <dt className="text-[12px] uppercase tracking-wide text-[var(--st-ink-muted)]">{label}</dt>
      <dd className="st-figure break-words text-base font-semibold sm:text-lg">{children}</dd>
    </div>
  );
}
