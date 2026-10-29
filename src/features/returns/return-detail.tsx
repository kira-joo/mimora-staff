"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import Link from "next/link";
import type { ReactNode } from "react";
import { getReturnEndpoint, type ReturnDetail } from "src/api/returns.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { TONE_VAR } from "src/features/status/status-vocabulary";
import { ReturnActions } from "./return-actions";
import { ReturnStatusSignal } from "src/features/status/status-signal";
import { RETURN_STATUS } from "src/features/status/status-vocabulary";

export function ReturnDetailView({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getReturnEndpoint, options: { params: { id } } });
  return (
    <QueryState query={query} entityName="return" backRoute={{ path: AppRoute.RETURNS, label: "Returns" }}>
      {(ret) => <ReturnRecord ret={ret} onChanged={() => query.refetch()} />}
    </QueryState>
  );
}

function ReturnRecord({ ret, onChanged }: { ret: ReturnDetail; onChanged: () => void }) {
  const format = useStoreFormat();
  const tone = TONE_VAR[RETURN_STATUS[ret.status]?.tone ?? "neutral"];
  const received = ret.lines.filter((line) => line.disposition).length;

  return (
    <PageShell
      title={<span className="st-figure text-[20px] font-semibold">{ret.returnNumber}</span>}
      description={`Requested ${format.dateTime(ret.requestedAt)}`}
      backRoute={{ path: AppRoute.RETURNS, label: "Returns" }}
      actions={<ReturnActions ret={ret} onChanged={onChanged} />}
    >
      <div className="relative mb-5 flex flex-wrap gap-x-8 gap-y-2 border border-[var(--st-line)] bg-[var(--st-surface)] px-5 py-3.5">
        <span aria-hidden="true" className="absolute inset-y-0 start-0 w-[var(--st-rail)]" style={{ background: tone }} />
        <Field label="Status">
          <ReturnStatusSignal status={ret.status} />
        </Field>
        <Field label="Order">
          {ret.orderNumber ? (
            <Link href={AppRoute.ORDER(ret.orderId)} className="st-figure whitespace-nowrap underline-offset-2 hover:underline">
              {ret.orderNumber}
            </Link>
          ) : (
            "—"
          )}
        </Field>
        <Field label="Received">
          <span className="st-figure">
            {received} / {ret.lines.length} lines
          </span>
        </Field>
        {ret.processedAt ? <Field label="Processed">{format.dateTime(ret.processedAt)}</Field> : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title={`Items (${ret.lines.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-start">
              <thead>
                <tr className="border-b border-[var(--st-line)] text-[13px] text-[var(--st-ink-muted)]">
                  <th className="py-2 pe-3 text-start font-medium">Item</th>
                  <th className="py-2 pe-3 text-start font-medium">SKU</th>
                  <th className="py-2 pe-3 text-end font-medium">Qty</th>
                  <th className="py-2 pe-3 text-start font-medium">Reason</th>
                  <th className="py-2 pe-3 text-start font-medium">Condition (customer / found)</th>
                  <th className="py-2 text-start font-medium">Disposition</th>
                </tr>
              </thead>
              <tbody>
                {ret.lines.map((line) => (
                  <tr key={line.returnLineId} className="border-b border-[var(--st-line)] align-top last:border-0">
                    <td className="py-2.5 pe-3">
                      <span dir="auto" className="block font-medium">
                        {line.productName}
                      </span>
                      {line.variantDescription ? (
                        <span dir="auto" className="block text-[13px] text-[var(--st-ink-muted)]">
                          {line.variantDescription}
                        </span>
                      ) : null}
                    </td>
                    <td className="st-figure whitespace-nowrap py-2.5 pe-3">{line.sku}</td>
                    <td className="st-figure py-2.5 pe-3 text-end">{line.quantity}</td>
                    <td dir="auto" className="py-2.5 pe-3">
                      {line.reason}
                    </td>
                    <td className="py-2.5 pe-3">
                      <span dir="auto" className="block">
                        {line.condition}
                      </span>
                      {line.inspectedCondition ? (
                        <span dir="auto" className="mt-0.5 block text-[13px] text-[var(--st-ink-muted)]">
                          Found: {line.inspectedCondition}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap py-2.5">
                      {line.disposition === "RESTOCK" ? "Restocked" : line.disposition === "DISCARD" ? "Discarded" : <span className="text-[var(--st-ink-muted)]">Awaiting receipt</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel title="Reason">
            <p dir="auto" className="whitespace-pre-line">
              {ret.reason}
            </p>
          </Panel>
          {ret.refundReference || ret.refundAmount ? (
            <Panel title="Refund">
              <dl className="flex flex-col gap-2">
                <Row label="Amount">
                  <span className="st-figure font-semibold">{format.money(ret.refundAmount)}</span>
                </Row>
                <Row label="Reference">
                  <span className="st-figure break-all">{ret.refundReference ?? "—"}</span>
                </Row>
              </dl>
            </Panel>
          ) : null}
          {ret.notes ? (
            <Panel title="Notes">
              <p dir="auto" className="whitespace-pre-line">
                {ret.notes}
              </p>
            </Panel>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 border border-[var(--st-line)] bg-[var(--st-surface)] p-5">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--st-ink-muted)]">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[13px] text-[var(--st-ink-muted)]">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
      <dt className="text-[var(--st-ink-muted)]">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
