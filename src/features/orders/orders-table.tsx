"use client";

import { SortOrder } from "@kira-joo/frontend-toolkit-core";
import { FeatureTable, FeatureFilterType } from "@kira-joo/frontend-toolkit-tailwind/table";
import { ClipboardList } from "lucide-react";
import { useRouter } from "next/navigation";
import { listOrdersEndpoint, type OrderListItem } from "src/api/orders.endpoints";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { OrderStatusSignal, PaymentStatusSignal } from "src/features/status/status-signal";
import { ORDER_STATUS, PAYMENT_STATUS } from "src/features/status/status-vocabulary";

const optionsOf = <K extends string>(spec: Record<K, { label: string }>) =>
  (Object.keys(spec) as K[]).map((value) => ({ value, label: spec[value].label }));

/**
 * The order list (MDS §6.2): filter by order status, payment status and
 * fulfilment mode — two separate axes, filtered separately — newest first.
 * Filters, sort and page live in the URL, so a filtered view is a link.
 */
export function OrdersTable() {
  const router = useRouter();
  const format = useStoreFormat();

  return (
    <FeatureTable<OrderListItem>
      endpoint={listOrdersEndpoint}
      entityName="orders"
      // Server-side: order number, customer name or phone (`orderSearchClause`). Under two characters is no search.
      searchable
      searchPlaceholder="Search order number, customer name or phone"
      selectable
      bulkActions={[
        {
          label: "Print picking list",
          icon: ClipboardList,
          // The page re-reads the orders itself from their ids; only ids travel in the link.
          onClick: ({ selectedIds }) => {
            window.open(AppRoute.PRINT_PICKING_LIST(selectedIds), "_blank", "noopener");
          },
        },
      ]}
      sortBy="placedAt"
      sortOrder={SortOrder.DESC}
      defaultLimit={25}
      filters={[
        { key: "status", header: "Order status", options: optionsOf(ORDER_STATUS) },
        { key: "paymentStatus", header: "Payment", options: optionsOf(PAYMENT_STATUS) },
        {
          type: FeatureFilterType.SELECT,
          key: "mode",
          header: "Fulfilment",
          options: [
            { value: "DELIVERY", label: "Delivery" },
            { value: "PICKUP", label: "Pickup" },
          ],
        },
      ]}
      onRowClick={(row) => router.push(AppRoute.ORDER(row._id))}
      emptyMessage="No orders match these filters"
      emptyDescription="Clear a filter to widen the list."
      columns={[
        {
          key: "placedAt",
          header: "Order",
          sortable: true,
          render: (row) => (
            <div className="flex flex-col">
              <span className="st-figure whitespace-nowrap font-medium text-[var(--st-ink)]">{row.orderNumber}</span>
              <span className="whitespace-nowrap text-[13px] text-[var(--st-ink-muted)]">{format.dateTime(row.placedAt)}</span>
            </div>
          ),
        },
        {
          key: "customer",
          header: "Customer",
          render: (row) => (
            <span dir="auto" className="block max-w-[16rem] truncate">
              {row.customerName ?? row.guestName ?? (row.customerId ? "Registered customer" : "Guest")}
            </span>
          ),
        },
        { key: "status", header: "Order status", render: (row) => <OrderStatusSignal status={row.status} /> },
        { key: "paymentStatus", header: "Payment", render: (row) => <PaymentStatusSignal status={row.paymentStatus} /> },
        { key: "mode", header: "Fulfilment", render: (row) => (row.mode === "DELIVERY" ? `Delivery${row.zone ? ` · ${row.zone}` : ""}` : "Pickup") },
        { key: "itemCount", header: "Items", align: "right", render: (row) => <span className="st-figure">{row.itemCount}</span> },
        { key: "total", header: "Total", align: "right", sortable: true, render: (row) => <span className="st-figure whitespace-nowrap">{format.money(row.total)}</span> },
      ]}
    />
  );
}
