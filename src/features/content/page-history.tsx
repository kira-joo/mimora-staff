"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { useState } from "react";
import { getPageRevisionEndpoint, listPageRevisionsEndpoint, type PageRevisionSummary } from "src/api/pages.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { displayName } from "src/features/catalog/catalog-display";
import { TONE_VAR } from "src/features/status/status-vocabulary";

/**
 * Every version of a page, and the text of any one of them (D-13). An order
 * records only "terms version N", so staff must be able to open version N and
 * read exactly what the customer accepted, long after the page has moved on.
 */
export function PageHistory({ pageId }: { pageId: string }) {
  const format = useStoreFormat();
  const history = useRequesterQuery({ endpoint: listPageRevisionsEndpoint, options: { params: { id: pageId } } });
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <section aria-labelledby="page-history-heading" className="mt-5 min-w-0 border border-[var(--st-line)] bg-[var(--st-surface)] p-5">
      <h2 id="page-history-heading" className="mb-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--st-ink-muted)]">
        Version history
      </h2>
      <p className="mb-3 max-w-[62ch] text-[13px] text-[var(--st-ink-muted)]">
        Changing the title or text makes a new version; older versions are kept unchanged. An order records the version of the terms the customer accepted — open it here to read it.
      </p>

      {history.isError ? (
        <p role="alert" className="text-[var(--st-status-danger)]">
          The history couldn&apos;t be loaded.
        </p>
      ) : null}
      {history.isPending ? <p className="text-[var(--st-ink-muted)]">Loading history…</p> : null}

      <ul className="flex flex-col">
        {history.data?.revisions.map((revision) => (
          <RevisionRow key={revision.version} revision={revision} open={selected === revision.version} onToggle={() => setSelected(selected === revision.version ? null : revision.version)} pageId={pageId} formatDate={format.dateTime} />
        ))}
      </ul>
    </section>
  );
}

function RevisionRow({ revision, open, onToggle, pageId, formatDate }: { revision: PageRevisionSummary; open: boolean; onToggle: () => void; pageId: string; formatDate: (value: string | undefined | null) => string }) {
  const panelId = `page-revision-${revision.version}`;
  return (
    <li className="border-b border-[var(--st-line)] last:border-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex min-h-[var(--st-tap-min)] w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5 text-start hover:bg-[var(--st-canvas)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--st-focus)]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="st-figure font-semibold whitespace-nowrap">Version {revision.version}</span>
          <span dir="auto" className="truncate text-[var(--st-ink-muted)]">
            {displayName(revision.title)}
          </span>
        </span>
        <span className="flex items-center gap-4">
          {revision.isCurrent ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium" style={{ color: TONE_VAR.done }}>
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              Current
            </span>
          ) : null}
          <span className="whitespace-nowrap text-[13px] text-[var(--st-ink-muted)]">{formatDate(revision.createdAt)}</span>
          <span aria-hidden="true" className="text-[13px] text-[var(--st-ink-muted)]">
            {open ? "Hide" : "Read"}
          </span>
        </span>
      </button>
      {open ? <RevisionText id={panelId} pageId={pageId} version={revision.version} /> : null}
    </li>
  );
}

/** The text of one version, in both languages, each block auto-directioned: Arabic and English content sit side by side in an English console. */
function RevisionText({ id, pageId, version }: { id: string; pageId: string; version: number }) {
  const query = useRequesterQuery({ endpoint: getPageRevisionEndpoint, options: { params: { id: pageId, version } } });

  return (
    <div id={id} className="mb-3 grid gap-4 border-t border-[var(--st-line)] pt-3 lg:grid-cols-2">
      {query.isError ? (
        <p role="alert" className="text-[var(--st-status-danger)] lg:col-span-2">
          This version couldn&apos;t be loaded.
        </p>
      ) : null}
      {query.isPending ? <p className="text-[var(--st-ink-muted)] lg:col-span-2">Loading version {version}…</p> : null}
      {query.data
        ? (["en", "ar"] as const).map((locale) => (
            <article key={locale} className="min-w-0">
              <h3 className="mb-1 text-[13px] font-semibold text-[var(--st-ink-muted)]">{locale === "en" ? "English" : "Arabic"}</h3>
              <p dir="auto" className="mb-2 break-words font-medium">
                {query.data.title[locale] || <span className="text-[var(--st-ink-muted)]">No title in this language</span>}
              </p>
              <div dir="auto" className="max-h-[420px] overflow-y-auto whitespace-pre-wrap break-words border border-[var(--st-line)] p-3 leading-relaxed">
                {query.data.content[locale] || <span className="text-[var(--st-ink-muted)]">No text in this language</span>}
              </div>
            </article>
          ))
        : null}
    </div>
  );
}
