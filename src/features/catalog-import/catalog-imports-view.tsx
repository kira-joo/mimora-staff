"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { useConfirm } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomButton, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { FeatureTable } from "@kira-joo/frontend-toolkit-tailwind/table";
import { useEndpointUpload } from "@kira-joo/frontend-toolkit-tailwind/upload";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, ImageOff, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { listCatalogImportsEndpoint, rebuildListingsEndpoint, stageCatalogImportEndpoint, type CatalogImportBatch } from "src/api/catalog-imports.endpoints";
import { cleanUpUnusedImagesEndpoint, type CleanUpUnusedImagesResult } from "src/api/media.endpoints";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { useStoreFormat } from "src/common/format/store-format";
import { uploadErrorMessage } from "src/features/media/upload-error-message";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { ImportStatusSignal } from "./import-status-signal";
import { describeSummary, templateCsv } from "./import-preview";
import { cleanUpCounts, cleanUpSummary } from "./clean-up-summary";

/**
 * The import screen: upload a CSV to stage it (it is read, checked and stored — nothing goes live), download the
 * template, and see earlier batches. Opening a batch shows the preview, where it is published or discarded.
 * Catalog.publish also gets two catalog-wide maintenance actions here: rebuild listing data, and clean up unused images.
 */
export function CatalogImportsView() {
  const can = usePermission();
  const router = useRouter();
  const queryClient = useQueryClient();
  const format = useStoreFormat();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string>();
  const { status, upload } = useEndpointUpload<typeof stageCatalogImportEndpoint, CatalogImportBatch>({ uploadEndpoint: stageCatalogImportEndpoint, fileFieldName: "file" });
  const uploading = status === "uploading";
  const [rebuilding, setRebuilding] = useState(false);
  const { confirm } = useConfirm();
  const [cleaning, setCleaning] = useState(false);
  const [cleanUpResult, setCleanUpResult] = useState<CleanUpUnusedImagesResult>();

  async function rebuildListings() {
    setRebuilding(true);
    let processed = 0;
    const ok = await runAction(async () => {
      processed = (await requester(rebuildListingsEndpoint)).processed;
    });
    setRebuilding(false);
    if (ok) {
      void queryClient.invalidateQueries();
      toast.success(`Rebuilt the listing data of ${processed} product${processed === 1 ? "" : "s"}`);
    }
  }

  async function cleanUpUnusedImages() {
    const ok = await confirm({
      title: "Delete unused images?",
      description:
        "Images uploaded more than 24 hours ago that no product, variant, category, collection, store profile or page uses are permanently deleted from image storage. Images in use, and anything uploaded in the last 24 hours, are never touched. Oldest first, one batch per run. This can't be undone.",
      confirmLabel: "Delete unused images",
    });
    if (!ok) return;

    setCleaning(true);
    let result: CleanUpUnusedImagesResult | undefined;
    const done = await runAction(async () => {
      result = await requester(cleanUpUnusedImagesEndpoint);
    });
    setCleaning(false);
    if (!done || !result) return;

    setCleanUpResult(result);
    const summary = cleanUpSummary(result);
    if (summary.tone === "warning") toast.warning(summary.message);
    else toast.success(summary.message);
  }

  async function stage(file: File | undefined) {
    if (!file) return;
    setProblem(undefined);
    try {
      const batch = await upload(file);
      void queryClient.invalidateQueries();
      toast.success(batch.summary?.errors ? `Staged with ${batch.summary.errors} problem${batch.summary.errors === 1 ? "" : "s"} — review them` : "Staged — review the preview, then publish");
      router.push(AppRoute.CATALOG_IMPORT(batch._id));
    } catch (error) {
      setProblem(uploadErrorMessage(error, "The file could not be staged."));
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "catalog-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="import-upload" className="flex flex-col gap-3 rounded-md border border-[var(--st-line)] bg-[var(--st-surface)] p-4">
        <h2 id="import-upload" className="text-[13px] font-semibold uppercase tracking-wide text-[var(--st-ink-muted)]">
          Stage a file
        </h2>
        <p className="max-w-prose text-[var(--st-ink)]">
          One row per variant; rows with the same <span className="st-figure">product_slug</span> are one product. Save from Excel as <strong>CSV UTF-8 (Comma delimited)</strong> so Arabic text survives. A blank cell never erases what a
          product already has.
        </p>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-label="Choose a CSV file to stage" onChange={(event) => { void stage(event.target.files?.[0]); event.target.value = ""; }} />
          {can(AppPermission.CATALOG_IMPORT_BATCH.CREATE) ? (
            <CustomButton type="button" leftIcon={FileUp} disabled={uploading} onClick={() => input.current?.click()}>
              {uploading ? "Reading the file…" : "Choose CSV file"}
            </CustomButton>
          ) : null}
          <CustomButton type="button" variant="outline" leftIcon={Download} onClick={downloadTemplate}>
            Download template
          </CustomButton>
        </div>
        {problem ? (
          <p role="alert" className="font-medium text-[var(--st-status-danger)]">
            {problem}
          </p>
        ) : null}
      </section>

      {can(CustomPermission.CATALOG_PUBLISH) ? (
        <section aria-labelledby="import-rebuild" className="flex flex-col gap-3 rounded-md border border-[var(--st-line)] bg-[var(--st-surface)] p-4">
          <h2 id="import-rebuild" className="text-[13px] font-semibold uppercase tracking-wide text-[var(--st-ink-muted)]">
            Rebuild listing data
          </h2>
          <p className="max-w-prose text-[var(--st-ink)]">
            Recomputes what product cards and filters show — price range, sizes and colours on offer, low stock — from each product&apos;s variants, then refreshes the storefront. Run it once after an upgrade that adds listing
            fields. Safe to run again.
          </p>
          <div>
            <CustomButton type="button" variant="outline" leftIcon={RefreshCw} loading={rebuilding} disabled={rebuilding} onClick={() => void rebuildListings()}>
              {rebuilding ? "Rebuilding…" : "Rebuild listings"}
            </CustomButton>
          </div>
        </section>
      ) : null}

      {can(CustomPermission.CATALOG_PUBLISH) ? (
        <section aria-labelledby="import-clean-up" className="flex flex-col gap-3 rounded-md border border-[var(--st-line)] bg-[var(--st-surface)] p-4">
          <h2 id="import-clean-up" className="text-[13px] font-semibold uppercase tracking-wide text-[var(--st-ink-muted)]">
            Unused images
          </h2>
          <p className="max-w-prose text-[var(--st-ink)]">
            Images are stored as soon as they are uploaded, before the product or page is saved, so an upload nobody saved stays in storage. This deletes those that are more than 24 hours old and used nowhere. Images in use are
            never deleted.
          </p>
          <div>
            <CustomButton type="button" variant="outline" leftIcon={ImageOff} loading={cleaning} disabled={cleaning} onClick={() => void cleanUpUnusedImages()}>
              {cleaning ? "Cleaning up…" : "Clean up unused images"}
            </CustomButton>
          </div>
          {cleanUpResult ? (
            <dl aria-label="Last clean-up" className="grid max-w-md grid-cols-4 gap-2">
              {cleanUpCounts(cleanUpResult).map((count) => (
                <div key={count.label} className="flex flex-col gap-0.5 rounded-md border border-[var(--st-line)] px-3 py-2">
                  <dt className="text-[13px] text-[var(--st-ink-muted)]">{count.label}</dt>
                  <dd className={count.label === "Failed" && count.value > 0 ? "st-figure font-semibold text-[var(--st-status-danger)]" : "st-figure font-semibold text-[var(--st-ink)]"}>{count.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ) : null}

      <FeatureTable<CatalogImportBatch>
        endpoint={listCatalogImportsEndpoint}
        entityName="imports"
        defaultLimit={25}
        onRowClick={(row) => router.push(AppRoute.CATALOG_IMPORT(row._id))}
        emptyMessage="No imports yet"
        emptyDescription="Stage a CSV file above. It is checked and previewed here before anything is published."
        columns={[
          { key: "filename", header: "File", render: (row) => <span dir="auto" className="truncate font-medium">{row.filename ?? "—"}</span> },
          { key: "status", header: "Status", render: (row) => <ImportStatusSignal status={row.status} /> },
          { key: "summary", header: "Would change", render: (row) => <span className="text-[var(--st-ink-muted)]">{row.summary ? describeSummary(row.summary) : "—"}</span> },
          { key: "errors", header: "Problems", render: (row) => <span className={row.summary?.errors ? "st-figure font-medium text-[var(--st-status-danger)]" : "st-figure"}>{row.summary?.errors ?? 0}</span> },
          { key: "createdAt", header: "Staged", render: (row) => <span className="whitespace-nowrap">{format.dateTime(row.createdAt)}</span> },
        ]}
      />
    </div>
  );
}
