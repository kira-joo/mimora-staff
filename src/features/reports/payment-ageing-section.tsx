"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import Link from "next/link";
import { paymentAgeingEndpoint } from "src/api/reports.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { BAND_LABEL, BAND_TONE, waitLabel } from "src/features/payments/payment-ageing";
import { TONE_VAR } from "src/features/status/status-vocabulary";

/**
 * Transfers awaiting verification, by how long they have waited — "the
 * ageing is the point, not the count". Bands and hours come from the report;
 * the work itself happens in the Payments queue.
 */
export function PaymentAgeingSection() {
  const query = useRequesterQuery({ endpoint: paymentAgeingEndpoint });

  return (
    <section aria-labelledby="ageing-heading" className="flex flex-col gap-4 rounded-md border border-[var(--st-line)] bg-[var(--st-surface)] p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ageing-heading" className="text-lg font-semibold">
          Payments awaiting verification
        </h2>
        <Link href={AppRoute.PAYMENTS} className="min-h-11 content-center text-[13px] font-medium text-[var(--st-accent)] underline underline-offset-2">
          Open the queue
        </Link>
      </header>
      <QueryState query={query} entityName="payment ageing">
        {(report) =>
          report.count === 0 ? (
            <p className="text-[var(--st-ink-muted)]">Nothing is waiting — every submitted proof has been decided.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <p>
                <span className="st-figure font-semibold">{report.count}</span> waiting; the oldest for{" "}
                <span className="font-semibold" style={{ color: TONE_VAR[BAND_TONE[report.items[0]?.band ?? "UNDER_24H"]] }}>
                  {waitLabel(report.oldestWaitingHours ?? 0)}
                </span>
                .
              </p>
              <dl className="grid grid-cols-3 gap-3">
                {report.bands.map(({ band, count }) => (
                  <div key={band} className="min-w-0 rounded-md border border-[var(--st-line)] px-3 py-2">
                    <dt className="text-[12px] uppercase tracking-wide text-[var(--st-ink-muted)]">{BAND_LABEL[band]}</dt>
                    <dd className="st-figure break-words text-base font-semibold sm:text-lg" style={{ color: count ? TONE_VAR[BAND_TONE[band]] : undefined }}>
                      {count}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )
        }
      </QueryState>
    </section>
  );
}
