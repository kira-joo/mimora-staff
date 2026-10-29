"use client";

import { DialogBody, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import Link from "next/link";
import type { ActivityEntry } from "src/api/activity.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { changeLines, humanize, recordLink } from "./activity-display";

/** One entry in full: who, when, from where, and the body they sent. Read-only — the log has no write route. */
export function ActivityEntryDrawer({ entry, titleId, descriptionId }: DialogContentProps<void> & { entry: ActivityEntry }) {
  const format = useStoreFormat();
  const link = recordLink(entry.entityType, entry.entityId);
  const lines = changeLines(entry.changes);

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title={`${humanize(entry.entityType)} · ${humanize(entry.action)}`}
      description={<span className="st-figure">{format.dateTime(entry.at)}</span>}
    >
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
          <dt className="text-[var(--st-ink-muted)]">By</dt>
          <dd className="min-w-0">
            <span dir="auto" className="block truncate font-medium">
              {entry.actor.name ?? "Unknown staff member"}
            </span>
            {entry.actor.email ? (
              <bdi dir="ltr" className="block truncate text-[13px] text-[var(--st-ink-muted)]">
                {entry.actor.email}
              </bdi>
            ) : null}
          </dd>
          <dt className="text-[var(--st-ink-muted)]">Record</dt>
          <dd className="min-w-0">
            {link ? (
              <Link href={link.href} className="font-medium text-[var(--st-accent)] underline underline-offset-2">
                Open {link.noun}
              </Link>
            ) : entry.entityId ? (
              <span className="st-figure break-all text-[13px]">{entry.entityId}</span>
            ) : (
              <span className="text-[var(--st-ink-muted)]">—</span>
            )}
          </dd>
          {entry.ipAddress ? (
            <>
              <dt className="text-[var(--st-ink-muted)]">IP address</dt>
              <dd className="st-figure">{entry.ipAddress}</dd>
            </>
          ) : null}
        </dl>
        <section aria-labelledby="changes-heading" className="flex flex-col gap-2">
          <h3 id="changes-heading" className="text-[13px] font-semibold uppercase tracking-wide text-[var(--st-ink-muted)]">
            What was sent
          </h3>
          {lines.length === 0 ? (
            <p className="text-[var(--st-ink-muted)]">No details — this action sends no data.</p>
          ) : (
            <dl className="divide-y divide-[var(--st-line)] rounded-md border border-[var(--st-line)]">
              {lines.map((line) => (
                <div key={line.path} className="flex flex-col gap-0.5 px-3 py-2">
                  <dt className="st-figure text-[12px] text-[var(--st-ink-muted)]">{line.path}</dt>
                  <dd dir="auto" className="break-words">
                    {line.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-[12px] text-[var(--st-ink-muted)]">Passwords, tokens and similar fields are recorded as “[redacted]”.</p>
        </section>
      </div>
    </DialogBody>
  );
}
