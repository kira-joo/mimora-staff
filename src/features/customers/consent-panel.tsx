"use client";

import { BadgeCheck, CircleDashed } from "lucide-react";
import type { ConsentEvent, ConsentSource, ConsentState, CustomerNewsletterState } from "src/api/customers.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { TONE_VAR } from "src/features/status/status-vocabulary";

const SOURCE_LABEL: Record<ConsentSource, string> = {
  signup: "at signup",
  account: "in their account",
  checkout: "at checkout",
  newsletter: "through the newsletter form",
};

/** One sentence for the current state — never colour alone: an icon and words carry it. */
export function consentSummary(consent: ConsentState): string {
  if (consent.at === undefined || consent.source === undefined) return "Never asked — treated as no consent.";
  return consent.granted ? `Agreed ${SOURCE_LABEL[consent.source]}` : `Withdrawn ${SOURCE_LABEL[consent.source]}`;
}

/** The customer's marketing consent: current state, when it last changed, the newsletter row, and the history that proves it. Read-only — only the customer changes consent. */
export function ConsentPanel({ consent, events, newsletter }: { consent: ConsentState; events: ConsentEvent[]; newsletter: CustomerNewsletterState | null }) {
  const format = useStoreFormat();
  const Icon = consent.granted ? BadgeCheck : CircleDashed;
  return (
    <div className="flex flex-col gap-3">
      <p className="inline-flex flex-wrap items-center gap-2 font-medium" style={{ color: TONE_VAR[consent.granted ? "done" : "neutral"] }}>
        <Icon aria-hidden="true" className="size-4" />
        {consent.granted ? "Marketing consent given" : "No marketing consent"}
      </p>
      <p className="text-[var(--st-ink-muted)]">
        {consentSummary(consent)}
        {consent.at ? <> · {format.dateTime(consent.at)}</> : null}
      </p>
      <p className="text-[var(--st-ink-muted)]">
        Newsletter:{" "}
        {newsletter ? (newsletter.status === "SUBSCRIBED" ? `subscribed${newsletter.consentedAt ? ` ${format.dateTime(newsletter.consentedAt)}` : ""}` : newsletter.status === "PENDING" ? "pending — the address has not confirmed, so it is not subscribed" : `unsubscribed${newsletter.unsubscribedAt ? ` ${format.dateTime(newsletter.unsubscribedAt)}` : ""}`) : "not on the list"}
      </p>
      {events.length > 0 ? (
        <details>
          <summary className="min-h-[var(--st-tap-min)] cursor-pointer py-2 text-[13px] font-medium">History ({events.length})</summary>
          <ul className="flex flex-col">
            {events.map((event) => (
              <li key={event._id} className="flex flex-wrap justify-between gap-x-4 border-b border-[var(--st-line)] py-1.5 last:border-0">
                <span>{event.granted ? "Agreed" : "Withdrawn"} {SOURCE_LABEL[event.source]}</span>
                <span className="whitespace-nowrap text-[var(--st-ink-muted)]">{format.dateTime(event.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
