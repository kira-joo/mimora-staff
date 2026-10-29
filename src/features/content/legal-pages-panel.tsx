"use client";

import { requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomButton, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { AlertTriangle, FilePlus2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { createLegalDraftsEndpoint, legalPagesEndpoint, type CreateLegalDraftsResult } from "src/api/pages.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { TONE_VAR } from "src/features/status/status-vocabulary";
import { LEGAL_PAGE_LABEL, draftsCreatedMessage, legalPageSignal, summarizeLegalPages } from "./legal-pages";

/**
 * The seven legal pages at a glance — which are missing or unpublished — and the
 * one action that adds the missing ones as UNPUBLISHED drafts. The drafts are
 * starting text for the owner to edit, not legal advice; nothing here publishes.
 *
 * Orders are refused until the terms page is published, so that is stated here
 * rather than discovered at the first customer checkout.
 */
export function LegalPagesPanel({ onChanged }: { onChanged?: () => void }) {
  const can = usePermission();
  const query = useRequesterQuery({ endpoint: legalPagesEndpoint });
  const [busy, setBusy] = useState(false);
  const overview = query.data;

  if (query.isError) {
    return (
      <p role="alert" className="mb-5 text-[var(--st-status-danger)]">
        The legal pages&apos; status couldn&apos;t be loaded.
      </p>
    );
  }
  if (!overview) return null;

  const summary = summarizeLegalPages(overview);
  const canCreate = can(AppPermission.PAGE.CREATE) && summary.missing > 0;

  async function createDrafts() {
    setBusy(true);
    let result: CreateLegalDraftsResult | undefined;
    const ok = await runAction(async () => {
      result = await requester(createLegalDraftsEndpoint);
    });
    setBusy(false);
    if (!ok || !result) return;
    toast.success(draftsCreatedMessage(result.created, result.skipped));
    void query.refetch();
    onChanged?.();
  }

  return (
    <section aria-labelledby="legal-pages-heading" className="mb-5 min-w-0 border border-[var(--st-line)] bg-[var(--st-surface)] p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="legal-pages-heading" className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--st-ink-muted)]">
            Legal pages
          </h2>
          <p className="mt-1 max-w-[62ch] text-[13px] text-[var(--st-ink-muted)]">
            Terms, privacy, returns, delivery, cookies, accessibility and contact. Drafts are a starting point to edit — they are not legal advice and are never published for you.
          </p>
        </div>
        {canCreate ? (
          <CustomButton type="button" variant="outline" leftIcon={FilePlus2} onClick={createDrafts} loading={busy} disabled={busy}>
            Create legal page drafts
          </CustomButton>
        ) : null}
      </div>

      {!overview.termsPublished ? (
        <p role="status" className="mb-3 flex items-start gap-2 border border-[var(--st-line-strong)] px-3 py-2.5 font-medium" style={{ color: TONE_VAR.pending }}>
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="text-[var(--st-ink)]">
            Customers cannot place orders until the Terms of Sale page is published. Checkout asks for acceptance of the terms and refuses the order without a published version.
          </span>
        </p>
      ) : null}

      {summary.publishedWithDraftMarker > 0 ? (
        <p role="status" className="mb-3 flex items-start gap-2 px-1 font-medium" style={{ color: TONE_VAR.danger }}>
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="text-[var(--st-ink)]">
            {summary.publishedWithDraftMarker} published {summary.publishedWithDraftMarker === 1 ? "page still opens" : "pages still open"} with the DRAFT notice. Customers can read it.
          </span>
        </p>
      ) : null}

      <ul className="flex flex-col">
        {overview.pages.map((page) => {
          const signal = legalPageSignal(page);
          return (
            <li key={page.slug} className="flex min-h-[var(--st-tap-min)] flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[var(--st-line)] py-1.5 last:border-0">
              <span className="min-w-0">
                {page.pageId ? (
                  <Link href={AppRoute.PAGE(page.pageId)} className="font-medium underline-offset-2 hover:underline">
                    {LEGAL_PAGE_LABEL[page.slug]}
                  </Link>
                ) : (
                  <span className="font-medium">{LEGAL_PAGE_LABEL[page.slug]}</span>
                )}
                <span dir="ltr" className="st-figure ms-2 text-[13px] text-[var(--st-ink-muted)]">
                  /{page.slug}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {page.draftMarkerPresent ? <span className="text-[13px] text-[var(--st-ink-muted)]">Still marked DRAFT</span> : null}
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium" style={{ color: TONE_VAR[signal.tone] }}>
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                  {signal.text}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
