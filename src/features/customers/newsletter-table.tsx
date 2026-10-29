"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { FeatureTable, FeatureFilterType, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { Info, MailX } from "lucide-react";
import { useRef } from "react";
import { listNewsletterEndpoint, unsubscribeNewsletterEndpoint, type NewsletterSubscriber } from "src/api/newsletter.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { useStoreFormat } from "src/common/format/store-format";
import { usePermission } from "src/features/auth/use-permission";
import { TONE_VAR } from "src/features/status/status-vocabulary";

const STATUS_LABEL: Record<NewsletterSubscriber["status"], string> = {
  PENDING: "Pending — unconfirmed",
  SUBSCRIBED: "Subscribed",
  UNSUBSCRIBED: "Unsubscribed",
};

const SOURCE_LABEL: Record<NewsletterSubscriber["source"], string> = {
  footer: "Website footer",
  checkout: "Checkout",
  signup: "Signup",
  account: "Customer account",
  newsletter: "Newsletter form (signed in)",
};

/**
 * Everyone who gave an address for the newsletter, and the consent behind it. Capture only: nothing here sends. An
 * unsubscribed address stays listed — it is the suppression list, so the public form never re-adds it.
 *
 * **Pending is not subscribed.** A public sign-up is double opt-in: the address is Pending until its owner follows the
 * emailed link. With email delivery not configured no link is ever sent, so such an address stays Pending — the screen
 * says so, because a Pending row must never be mistaken for consent.
 */
export function NewsletterTable() {
  const can = usePermission();
  const format = useStoreFormat();
  const table = useRef<FeatureTableHandle>(null);
  const canUnsubscribe = can(AppPermission.NEWSLETTER_SUBSCRIBER.UPDATE);

  return (
    <>
    <p role="note" className="mb-4 flex items-start gap-2 border border-[var(--st-line)] bg-[var(--st-surface)] p-3 text-[var(--st-ink-muted)]">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        <strong className="font-medium text-[var(--st-ink)]">Pending</strong> addresses signed up on the website but have not confirmed: they are unconfirmed and not subscribed. A confirmation email is sent only when email delivery is configured; without it an address stays Pending.
      </span>
    </p>
    <FeatureTable<NewsletterSubscriber>
      ref={table}
      endpoint={listNewsletterEndpoint}
      entityName="subscribers"
      searchPlaceholder="Search email address"
      defaultLimit={25}
      filters={[
        {
          type: FeatureFilterType.SELECT,
          key: "status",
          header: "Status",
          options: [
            { value: "PENDING", label: "Pending confirmation" },
            { value: "SUBSCRIBED", label: "Subscribed" },
            { value: "UNSUBSCRIBED", label: "Unsubscribed" },
          ],
        },
      ]}
      emptyMessage="No subscribers yet"
      emptyDescription="Addresses appear here when visitors subscribe from the footer or at checkout, as Pending until they confirm by email."
      rowActions={
        canUnsubscribe
          ? [
              {
                label: "Unsubscribe",
                icon: MailX,
                destructive: true,
                hidden: (row) => row.status === "UNSUBSCRIBED",
                confirm: (row) => ({
                  title: "Unsubscribe this address?",
                  description: `${row.status === "PENDING" ? `${row.email} has not confirmed; its confirmation link will stop working.` : `${row.email} will no longer be a subscriber.`} It stays on the list as unsubscribed, so the website form can't add it again.`,
                  confirmLabel: "Unsubscribe",
                  destructive: true,
                }),
                onClick: async (row) => {
                  if (await runAction(() => requester(unsubscribeNewsletterEndpoint, { params: { id: row._id } }), "Unsubscribed")) table.current?.refetch();
                },
              },
            ]
          : undefined
      }
      columns={[
        { key: "email", header: "Email", render: (row) => <bdi dir="ltr" className="block max-w-[22rem] truncate font-medium">{row.email}</bdi> },
        {
          key: "status",
          header: "Status",
          render: (row) => (
            <span className="whitespace-nowrap font-medium" style={{ color: TONE_VAR[row.status === "SUBSCRIBED" ? "done" : row.status === "PENDING" ? "pending" : "neutral"] }}>
              {STATUS_LABEL[row.status]}
            </span>
          ),
        },
        { key: "source", header: "Source", render: (row) => SOURCE_LABEL[row.source] },
        { key: "locale", header: "Language", render: (row) => (row.locale === "ar" ? "Arabic" : "English") },
        { key: "consentedAt", header: "Consented", sortable: true, render: (row) => (row.consentedAt ? <span className="whitespace-nowrap">{format.dateTime(row.consentedAt)}</span> : <span className="text-[var(--st-ink-muted)]">Not yet</span>) },
      ]}
    />
    </>
  );
}
