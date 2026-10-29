"use client";

import { SortOrder } from "@kira-joo/frontend-toolkit-core";
import { drawerPresentation, useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { FeatureTable, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { SlidersHorizontal } from "lucide-react";
import { useRef } from "react";
import { listInventoryEndpoint, type InventoryItem } from "src/api/inventory.endpoints";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { usePermission } from "src/features/auth/use-permission";
import { AdjustStockDialog, BulkAdjustDialog } from "./adjust-stock-dialog";
import { StockSignal } from "./stock-signal";
import { stockState } from "./stock-state";

const BOOLEAN_OPTIONS = [{ value: "true", label: "Only" }];

/**
 * Stock per variant (MDS §14). Filters, sort and page live in the URL. The
 * server decides stock; this view displays it and submits adjustments, then
 * refetches. Adjust actions show only to roles holding Inventory.adjust (the
 * API checks again).
 */
export function InventoryTable() {
  const can = usePermission();
  const { openDialog } = useDialog();
  const table = useRef<FeatureTableHandle>(null);
  const canAdjust = can(CustomPermission.INVENTORY_ADJUST);

  async function adjust(item: InventoryItem) {
    const handle = openDialog<typeof AdjustStockDialog, boolean>({
      component: AdjustStockDialog,
      props: { item },
      presentation: drawerPresentation(),
    });
    const outcome = await handle.result;
    if (outcome.status === "resolved") table.current?.refetch();
  }

  return (
    <FeatureTable<InventoryItem>
      ref={table}
      endpoint={listInventoryEndpoint}
      entityName="variants"
      // No variant field is @Searchable server-side; a search box would accept text and filter nothing.
      searchable={false}
      sortBy="createdAt"
      sortOrder={SortOrder.DESC}
      defaultLimit={25}
      filters={[
        { key: "lowStock", header: "Low stock", options: BOOLEAN_OPTIONS },
        { key: "outOfStock", header: "Out of stock", options: BOOLEAN_OPTIONS },
      ]}
      selectable={canAdjust}
      bulkActions={
        canAdjust
          ? [
              {
                label: "Adjust stock",
                icon: SlidersHorizontal,
                // Only rows of the loaded page are known; refuse rather than act on ids we cannot show.
                disabled: ({ selectedIds, selectedItems }) => selectedItems.length === 0 || selectedItems.length !== selectedIds.length || selectedIds.length > 100,
                onClick: async ({ selectedItems, clearSelection }) => {
                  const handle = openDialog<typeof BulkAdjustDialog, boolean>({
                    component: BulkAdjustDialog,
                    props: { items: selectedItems },
                    presentation: drawerPresentation(),
                  });
                  const outcome = await handle.result;
                  if (outcome.status === "resolved") {
                    clearSelection();
                    table.current?.refetch();
                  }
                },
              },
            ]
          : undefined
      }
      rowActions={[{ label: "Adjust stock", icon: SlidersHorizontal, hidden: () => !canAdjust, onClick: adjust }]}
      emptyMessage="No variants match these filters"
      emptyDescription="Clear a filter to widen the list."
      columns={[
        {
          key: "product",
          header: "Product",
          render: (row) => (
            <div className="flex min-w-0 max-w-[22rem] flex-col">
              <span dir="auto" className="truncate font-medium">
                {row.productName.en || row.productName.ar}
              </span>
              {row.optionValues.length > 0 ? (
                <span dir="auto" className="truncate text-[13px] text-[var(--st-ink-muted)]">
                  {row.optionValues.map((o) => `${o.key}: ${o.value}`).join(" · ")}
                </span>
              ) : null}
            </div>
          ),
        },
        { key: "sku", header: "SKU", render: (row) => <span className="st-figure whitespace-nowrap">{row.sku}</span> },
        {
          key: "stock",
          header: "Stock",
          sortable: true,
          render: (row) => (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="st-figure min-w-[3ch] text-right text-[15px] font-medium text-[var(--st-ink)]">{row.stock}</span>
              <StockSignal state={stockState(row.stock, row.lowStockThreshold)} />
            </div>
          ),
        },
        {
          key: "backorderPolicy",
          header: "Backorder",
          render: (row) => (row.backorderPolicy === "CONTINUE_SELLING" ? "Keeps selling at zero" : "Stops at zero"),
        },
        {
          key: "discontinued",
          header: "Status",
          render: (row) => <span className={row.discontinued ? "font-medium" : "text-[var(--st-ink-muted)]"}>{row.discontinued ? "Discontinued" : "Active"}</span>,
        },
      ]}
    />
  );
}
