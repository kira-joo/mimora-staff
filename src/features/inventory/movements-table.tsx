"use client";

import { SortOrder } from "@kira-joo/frontend-toolkit-core";
import { FeatureTable } from "@kira-joo/frontend-toolkit-tailwind/table";
import Link from "next/link";
import { listMovementsEndpoint, type StockMovement } from "src/api/inventory.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { TONE_VAR } from "src/features/status/status-vocabulary";
import { MOVEMENT_REASON_LABEL, MOVEMENT_REASON_OPTIONS, formatDelta } from "./movement-display";

/**
 * The Adjustments log (MDS §14): the audit trail behind every stock count.
 * Read-only. Filters, sort and page live in the URL. A sale or an order
 * cancellation links to its order; an adjustment carries the staff member and
 * their note.
 */
export function MovementsTable() {
  const format = useStoreFormat();

  return (
    <FeatureTable<StockMovement>
      endpoint={listMovementsEndpoint}
      entityName="movements"
      // StockMovement has no @Searchable field; a search box would accept text and filter nothing.
      searchable={false}
      sortBy="at"
      sortOrder={SortOrder.DESC}
      defaultLimit={25}
      filters={[{ key: "reason", header: "Reason", options: MOVEMENT_REASON_OPTIONS }]}
      emptyMessage="No stock movements match these filters"
      emptyDescription="Sales, cancellations, returns and adjustments appear here as they happen."
      columns={[
        { key: "at", header: "When", render: (row) => <span className="st-figure whitespace-nowrap">{format.dateTime(row.at)}</span> },
        {
          key: "product",
          header: "Variant",
          render: (row) => (
            <div className="flex min-w-0 max-w-[22rem] flex-col">
              <span dir="auto" className="truncate font-medium">
                {row.productName.en || row.productName.ar}
              </span>
              <span className="st-figure truncate text-[13px] text-[var(--st-ink-muted)]">{row.sku}</span>
            </div>
          ),
        },
        { key: "reason", header: "Reason", render: (row) => <span className="whitespace-nowrap">{MOVEMENT_REASON_LABEL[row.reason]}</span> },
        {
          key: "delta",
          header: "Change",
          render: (row) => (
            <span className="st-figure whitespace-nowrap text-end font-medium" style={{ color: row.delta < 0 ? TONE_VAR.danger : undefined }}>
              {formatDelta(row.delta)}
            </span>
          ),
        },
        {
          key: "order",
          header: "Order",
          render: (row) =>
            row.orderId && row.orderNumber ? (
              <Link href={AppRoute.ORDER(row.orderId)} className="st-figure whitespace-nowrap underline-offset-2 hover:underline">
                {row.orderNumber}
              </Link>
            ) : (
              <span className="text-[var(--st-ink-muted)]">—</span>
            ),
        },
        {
          key: "actor",
          header: "By",
          render: (row) =>
            row.actor ? (
              <span dir="auto" className="block max-w-48 truncate">
                {row.actor.name ?? (row.actor.kind === "CUSTOMER" ? "Customer" : "Staff")}
              </span>
            ) : (
              <span className="text-[var(--st-ink-muted)]">{row.reason === "SALE" ? "Guest" : "—"}</span>
            ),
        },
        {
          key: "note",
          header: "Note",
          render: (row) =>
            row.note ? (
              <span dir="auto" className="block max-w-72 truncate" title={row.note}>
                {row.note}
              </span>
            ) : (
              <span className="text-[var(--st-ink-muted)]">—</span>
            ),
        },
      ]}
    />
  );
}
