"use client";

import { SortOrder } from "@kira-joo/frontend-toolkit-core";
import { modalPresentation, useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { FeatureTable, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { AlarmClockOff, ScanEye } from "lucide-react";
import { useRef } from "react";
import { paymentQueueEndpoint, type PaymentQueueItem } from "src/api/payments.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { paymentMethodLabel, TONE_VAR } from "src/features/status/status-vocabulary";
import { ageOf } from "./payment-ageing";
import { ReviewPaymentDrawer, type ReviewOutcome } from "./review-payment-drawer";

/**
 * The verification queue (MDS §6.4): every transfer whose proof awaits a
 * decision, oldest first — "the ageing is the point". A row opens the review
 * beside the list; a decision removes it from the queue.
 */
export function PaymentQueue() {
  const format = useStoreFormat();
  const { openDialog } = useDialog();
  const table = useRef<FeatureTableHandle>(null);
  const now = new Date();

  async function review(item: PaymentQueueItem) {
    const handle = openDialog<typeof ReviewPaymentDrawer, ReviewOutcome>({
      component: ReviewPaymentDrawer,
      props: { item },
      presentation: modalPresentation({ size: "lg" }),
    });
    const outcome = await handle.result;
    if (outcome.status === "resolved") table.current?.refetch();
  }

  return (
    <FeatureTable<PaymentQueueItem>
      ref={table}
      endpoint={paymentQueueEndpoint}
      entityName="payments"
      searchable={false}
      sortBy="placedAt"
      sortOrder={SortOrder.ASC}
      defaultLimit={25}
      rowKey="orderId"
      onRowClick={review}
      emptyMessage="Nothing to verify"
      emptyDescription="Every submitted payment proof has been reviewed."
      rowActions={[{ label: "Review", icon: ScanEye, onClick: review }]}
      columns={[
        {
          key: "placedAt",
          header: "Order",
          sortable: true,
          render: (row) => (
            <div className="flex flex-col">
              <span className="st-figure whitespace-nowrap font-medium">{row.orderNumber}</span>
              <span className="whitespace-nowrap text-[13px] text-[var(--st-ink-muted)]">{format.dateTime(row.placedAt)}</span>
            </div>
          ),
        },
        { key: "method", header: "Method", render: (row) => <span className="whitespace-nowrap">{paymentMethodLabel(row.method)}</span> },
        { key: "expectedAmount", header: "Expected", align: "right", render: (row) => <span className="st-figure whitespace-nowrap">{format.money(row.expectedAmount)}</span> },
        {
          key: "waiting",
          header: "Waiting",
          render: (row) => {
            if (!row.proof) return <span className="text-[var(--st-ink-muted)]">No proof</span>;
            const age = ageOf(row.proof.submittedAt, now);
            return (
              <span className="inline-flex flex-col">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium" style={{ color: TONE_VAR[age.tone] }}>
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                  {age.label}
                </span>
                {/* Past the method's verification window: a flag for triage, never an automatic action. Icon + text, not colour alone. */}
                {row.overdue ? (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium" style={{ color: TONE_VAR.danger }}>
                    <AlarmClockOff aria-hidden="true" className="size-3.5" />
                    Overdue
                  </span>
                ) : null}
              </span>
            );
          },
        },
        {
          key: "destination",
          header: "Paid to",
          render: (row) => (
            <span dir="auto" className="block max-w-[14rem] truncate">
              {row.destinationSnapshot?.accountName ?? "—"}
            </span>
          ),
        },
      ]}
    />
  );
}
