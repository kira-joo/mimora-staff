"use client";

import { SortOrder } from "@kira-joo/frontend-toolkit-core";
import { FeatureTable } from "@kira-joo/frontend-toolkit-tailwind/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listReturnsEndpoint, type ReturnListItem } from "src/api/returns.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { ReturnStatusSignal } from "src/features/status/status-signal";
import { RETURN_STATUS } from "src/features/status/status-vocabulary";

/** The return queue, newest request first. Filters, sort and page live in the URL. */
export function ReturnsTable() {
  const router = useRouter();
  const format = useStoreFormat();

  return (
    <FeatureTable<ReturnListItem>
      endpoint={listReturnsEndpoint}
      entityName="returns"
      // The Return schema has no @Searchable field; a search box would accept text and filter nothing.
      searchable={false}
      sortBy="requestedAt"
      sortOrder={SortOrder.DESC}
      defaultLimit={25}
      filters={[
        {
          key: "status",
          header: "Status",
          options: (Object.keys(RETURN_STATUS) as (keyof typeof RETURN_STATUS)[]).map((value) => ({ value, label: RETURN_STATUS[value].label })),
        },
      ]}
      onRowClick={(row) => router.push(AppRoute.RETURN(row._id))}
      emptyMessage="No returns match these filters"
      emptyDescription="Clear a filter to widen the list."
      columns={[
        {
          key: "requestedAt",
          header: "Return",
          render: (row) => (
            <div className="flex flex-col">
              <span className="st-figure whitespace-nowrap font-medium text-[var(--st-ink)]">{row.returnNumber}</span>
              <span className="whitespace-nowrap text-[13px] text-[var(--st-ink-muted)]">{format.dateTime(row.requestedAt)}</span>
            </div>
          ),
        },
        {
          key: "orderNumber",
          header: "Order",
          render: (row) =>
            row.orderNumber ? (
              <Link
                href={AppRoute.ORDER(row.orderId)}
                onClick={(event) => event.stopPropagation()}
                className="st-figure whitespace-nowrap underline-offset-2 hover:underline"
              >
                {row.orderNumber}
              </Link>
            ) : (
              "—"
            ),
        },
        { key: "reason", header: "Reason", render: (row) => <span dir="auto" className="block max-w-[20rem] truncate">{row.reason}</span> },
        { key: "status", header: "Status", render: (row) => <ReturnStatusSignal status={row.status} /> },
        {
          key: "processedAt",
          header: "Processed",
          render: (row) => <span className="whitespace-nowrap text-[var(--st-ink-muted)]">{row.processedAt ? format.dateTime(row.processedAt) : "—"}</span>,
        },
      ]}
    />
  );
}
