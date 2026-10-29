"use client";

import { requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { useConfirm } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomButton, PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { discardCatalogImportEndpoint, getCatalogImportEndpoint, publishCatalogImportEndpoint, type CatalogImportBatch, type ImportIssue } from "src/api/catalog-imports.endpoints";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { ImportStatusSignal } from "./import-status-signal";
import { describeSummary, previewRows, unplacedIssues } from "./import-preview";

const back = { path: AppRoute.CATALOG_IMPORTS, label: "Bulk import" };

/**
 * One staged batch: what publishing would do, every problem with its CSV line, and the rows themselves. A batch with
 * problems cannot be published — fix the file and stage it again (a batch is a snapshot of a file, not an editor).
 * Publish applies everything in one transaction or nothing; discard removes the batch and changes nothing.
 */
export function CatalogImportDetail({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getCatalogImportEndpoint, options: { params: { id } } });
  return (
    <QueryState query={query} entityName="import" backRoute={back}>
      {(batch) => <Detail batch={batch} refetch={() => void query.refetch()} />}
    </QueryState>
  );
}

function Detail({ batch, refetch }: { batch: CatalogImportBatch; refetch: () => void }) {
  const can = usePermission();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [busy, setBusy] = useState(false);

  const errors = batch.rowErrors ?? [];
  const warnings = batch.warnings ?? [];
  const rows = previewRows(batch.rows ?? [], [...errors, ...warnings]);
  const loose = unplacedIssues(rows, [...errors, ...warnings]);
  const staged = batch.status === "STAGED";
  const canPublish = staged && errors.length === 0 && can(CustomPermission.CATALOG_PUBLISH);
  const canDiscard = staged && can(AppPermission.CATALOG_IMPORT_BATCH.DELETE);

  async function publish() {
    const ok = await confirm({
      title: "Publish this import?",
      description: `${batch.summary ? describeSummary(batch.summary) : "The staged changes"} go live on the storefront now, all together. This cannot be undone as one step.`,
      confirmLabel: "Publish",
    });
    if (!ok) return;
    setBusy(true);
    const done = await runAction(() => requester(publishCatalogImportEndpoint, { params: { id: batch._id } }), "Import published");
    setBusy(false);
    if (done) {
      void queryClient.invalidateQueries();
      refetch();
    }
  }

  async function discard() {
    const ok = await confirm({ title: "Discard this import?", description: "The staged file is removed. Nothing live is affected.", confirmLabel: "Discard", destructive: true });
    if (!ok) return;
    setBusy(true);
    const done = await runAction(() => requester(discardCatalogImportEndpoint, { params: { id: batch._id } }), "Import discarded");
    setBusy(false);
    if (done) {
      void queryClient.invalidateQueries();
      router.push(AppRoute.CATALOG_IMPORTS);
    }
  }

  return (
    <PageShell
      title={<span dir="auto">{batch.filename ?? "Import"}</span>}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <ImportStatusSignal status={batch.status} />
          {batch.summary ? <span>{describeSummary(batch.summary)}</span> : null}
        </span>
      }
      backRoute={back}
      actions={
        staged ? (
          <div className="flex gap-2">
            {canDiscard ? (
              <CustomButton type="button" variant="outline" disabled={busy} onClick={() => void discard()}>
                Discard
              </CustomButton>
            ) : null}
            {can(CustomPermission.CATALOG_PUBLISH) ? (
              <CustomButton type="button" disabled={busy || !canPublish} onClick={() => void publish()}>
                {busy ? "Working…" : "Publish"}
              </CustomButton>
            ) : null}
          </div>
        ) : null
      }
      maxWidth="5xl"
    >
      <div className="flex flex-col gap-4">
        {staged ? (
          <p role="status" className="rounded-md border border-[var(--st-line)] bg-[var(--st-surface)] px-4 py-3">
            {errors.length > 0
              ? `This file has ${errors.length} problem${errors.length === 1 ? "" : "s"}, so it cannot be published. Nothing is live. Fix the file and stage it again.`
              : "Nothing from this file is live yet. Check the rows below, then publish."}
          </p>
        ) : null}
        {batch.status === "PUBLISHED" && batch.publishResult ? (
          <p role="status" className="rounded-md border border-[var(--st-line)] bg-[var(--st-surface)] px-4 py-3">
            Published: {batch.publishResult.products.created} products created, {batch.publishResult.products.updated} updated; {batch.publishResult.variants.created} variants created, {batch.publishResult.variants.updated} updated;{" "}
            {batch.publishResult.stockMovements.receipts} opening-stock receipts and {batch.publishResult.stockMovements.adjustments} stock adjustments recorded.
          </p>
        ) : null}

        {errors.length + warnings.length > 0 ? <IssueList errors={errors} warnings={warnings} /> : null}
        {loose.length > 0 ? <p className="text-[13px] text-[var(--st-ink-muted)]">{loose.length} message{loose.length === 1 ? "" : "s"} refer to the header or a line with no variant; they are listed above.</p> : null}

        <section aria-labelledby="rows-heading" className="rounded-md border border-[var(--st-line)] bg-[var(--st-surface)]">
          <h2 id="rows-heading" className="border-b border-[var(--st-line)] px-4 py-3 text-[13px] font-semibold uppercase tracking-wide text-[var(--st-ink-muted)]">
            Rows ({rows.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-start text-[13px]">
              <thead>
                <tr className="text-[12px] uppercase tracking-wide text-[var(--st-ink-muted)]">
                  {["Line", "Product", "Status", "SKU", "Options", "Price", "Stock", "Check"].map((heading, i) => (
                    <th key={heading} scope="col" className={`px-3 py-2 font-semibold ${i === 5 || i === 6 ? "text-end" : "text-start"}`}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.line} className="border-t border-[var(--st-line)] align-top">
                    <td className="st-figure px-3 py-1.5">{row.line}</td>
                    <td className="px-3 py-1.5">
                      <div dir="auto" className="font-medium">{row.name || row.slug}</div>
                      <div dir="ltr" className="st-figure text-[var(--st-ink-muted)]">{row.slug}</div>
                    </td>
                    <td className="px-3 py-1.5">{row.status || "—"}</td>
                    <td dir="ltr" className="st-figure px-3 py-1.5">{row.sku}</td>
                    <td dir="auto" className="px-3 py-1.5">{row.options || "—"}</td>
                    <td className="st-figure px-3 py-1.5 text-end">{row.price || "—"}</td>
                    <td className="st-figure px-3 py-1.5 text-end">{row.stock || "—"}</td>
                    <td className="px-3 py-1.5">
                      {row.issues.length === 0 ? (
                        <span className="text-[var(--st-ink-muted)]">OK</span>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {row.issues.map((issue, index) => (
                            <li key={index} className={errors.includes(issue) ? "font-medium text-[var(--st-status-danger)]" : "text-[var(--st-ink-muted)]"}>
                              {errors.includes(issue) ? "Problem: " : "Note: "}
                              {issue.column ? <span className="st-figure">{issue.column}: </span> : null}
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </PageShell>
  );
}

function IssueList({ errors, warnings }: { errors: ImportIssue[]; warnings: ImportIssue[] }) {
  const all = [...errors.map((issue) => ({ issue, error: true })), ...warnings.map((issue) => ({ issue, error: false }))].sort((a, b) => a.issue.row - b.issue.row);
  return (
    <section aria-labelledby="issues-heading" className="rounded-md border border-[var(--st-line)] bg-[var(--st-surface)]">
      <h2 id="issues-heading" className="border-b border-[var(--st-line)] px-4 py-3 text-[13px] font-semibold uppercase tracking-wide text-[var(--st-ink-muted)]">
        Problems ({errors.length}) and notes ({warnings.length})
      </h2>
      <ul className="flex max-h-80 flex-col overflow-y-auto">
        {all.map(({ issue, error }, index) => (
          <li key={index} className="flex items-start gap-2 border-t border-[var(--st-line)] px-4 py-2 first:border-t-0">
            {error ? <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--st-status-danger)]" /> : <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--st-status-pending)]" />}
            <span>
              <span className="sr-only">{error ? "Problem" : "Note"}, </span>
              <span className="st-figure font-medium">Line {issue.row}</span>
              {issue.column ? <span className="st-figure text-[var(--st-ink-muted)]"> · {issue.column}</span> : null}
              {issue.sku ? <span dir="ltr" className="st-figure text-[var(--st-ink-muted)]"> · {issue.sku}</span> : null}
              <span dir="auto"> — {issue.message}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
