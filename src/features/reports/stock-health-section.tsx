"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import Link from "next/link";
import { stockHealthEndpoint } from "src/api/reports.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { variantLabel } from "src/features/inventory/adjust-stock-dialog";
import { StockSignal } from "src/features/inventory/stock-signal";
import { TONE_VAR } from "src/features/status/status-vocabulary";

const MOST_URGENT = 10;

/**
 * Variants out of stock or at/below their threshold, lowest stock first —
 * discontinued ones excluded by the API. The counts cover the whole store;
 * the list is the most urgent few, with the full, adjustable list one tap
 * away in Inventory.
 */
export function StockHealthSection() {
  const query = useRequesterQuery({ endpoint: stockHealthEndpoint, options: { query: { limit: MOST_URGENT } } });

  return (
    <section aria-labelledby="stock-heading" className="flex flex-col gap-4 rounded-md border border-[var(--st-line)] bg-[var(--st-surface)] p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="stock-heading" className="text-lg font-semibold">
          Stock health
        </h2>
        <Link href={`${AppRoute.INVENTORY}?lowStock=true`} className="min-h-11 content-center text-[13px] font-medium text-[var(--st-accent)] underline underline-offset-2">
          Open in Inventory
        </Link>
      </header>
      <QueryState query={query} entityName="stock health">
        {(report) => (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-3">
              <div className="min-w-0 rounded-md border border-[var(--st-line)] px-3 py-2">
                <dt className="text-[12px] uppercase tracking-wide text-[var(--st-ink-muted)]">Out of stock</dt>
                <dd className="st-figure break-words text-base font-semibold sm:text-lg" style={{ color: report.outOfStockCount ? TONE_VAR.danger : undefined }}>
                  {report.outOfStockCount}
                </dd>
              </div>
              <div className="min-w-0 rounded-md border border-[var(--st-line)] px-3 py-2">
                <dt className="text-[12px] uppercase tracking-wide text-[var(--st-ink-muted)]">Running low</dt>
                <dd className="st-figure break-words text-base font-semibold sm:text-lg" style={{ color: report.lowStockCount ? TONE_VAR.pending : undefined }}>
                  {report.lowStockCount}
                </dd>
              </div>
            </dl>
            <p className="text-[13px] text-[var(--st-ink-muted)]">
              &ldquo;Running low&rdquo; is at or below a variant&apos;s own threshold, or the store default of <span className="st-figure">{report.defaultThreshold}</span>.
            </p>
            {report.data.length === 0 ? (
              <p className="text-[var(--st-ink-muted)]">Every active variant is above its threshold.</p>
            ) : (
              <ol className="divide-y divide-[var(--st-line)] rounded-md border border-[var(--st-line)]">
                {report.data.map((item) => (
                  <li key={item._id} className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                    <span className="flex min-w-0 flex-col">
                      <span dir="auto" className="truncate font-medium">
                        {variantLabel(item)}
                      </span>
                      <span className="st-figure text-[13px] text-[var(--st-ink-muted)]">{item.sku}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="st-figure text-[13px]">
                        {item.stock} / {item.effectiveThreshold}
                      </span>
                      {/* The report's own classification — not recomputed here. */}
                      <StockSignal state={item.health === "OUT_OF_STOCK" ? "OUT" : "LOW"} />
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </QueryState>
    </section>
  );
}
