"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton, RouteButton, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { FeatureTable, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { ArrowUpDown, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { deleteDeliveryZoneEndpoint, listDeliveryZonesEndpoint, reorderDeliveryZonesEndpoint, type DeliveryZone } from "src/api/delivery-zones.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { ReorderDialog } from "src/components/reorder-dialog";
import { usePermission } from "src/features/auth/use-permission";
import { TONE_VAR } from "src/features/status/status-vocabulary";
import { toOrderEntries } from "./fulfilment-values";

/** Zones in storefront order. DELETE soft-deletes, so the row action says "Delete"; switching a zone off is the edit form's Active switch. */
export function DeliveryZonesTable() {
  const router = useRouter();
  const can = usePermission();
  const { money } = useStoreFormat();
  const { openDialog } = useDialog();
  const table = useRef<FeatureTableHandle>(null);

  async function reorder() {
    // The reorder endpoint takes the whole order, so every zone must be loaded (the API caps a page at 100).
    let page;
    try {
      page = await requester(listDeliveryZonesEndpoint, { query: { limit: 100 } });
    } catch {
      toast.error("Could not load the zones to reorder. Try again.");
      return;
    }
    if (page.total > page.data.length) {
      toast.error(`There are ${page.total} zones; only ${page.data.length} can be reordered here.`);
      return;
    }
    const handle = openDialog({
      component: ReorderDialog,
      props: {
        title: "Reorder delivery zones",
        description: "Zones appear to customers in this order.",
        items: page.data.map((zone) => ({
          id: zone._id,
          name: zone.name.en || zone.name.ar || "Untitled zone",
          label: <span dir="auto">{zone.name.en || zone.name.ar || "Untitled zone"}</span>,
        })),
        save: (ids: string[]) => requester(reorderDeliveryZonesEndpoint, { body: { items: toOrderEntries(ids).map((e) => ({ zoneId: e.id, order: e.order })) } }),
      },
    });
    const outcome = await handle.result;
    if (outcome.status === "resolved") table.current?.refetch();
  }

  return (
    <FeatureTable<DeliveryZone>
      ref={table}
      endpoint={listDeliveryZonesEndpoint}
      entityName="delivery zones"
      // Zones are always in storefront order, and the list is short: no search or sort.
      searchable={false}
      defaultLimit={25}
      filters={[
        {
          key: "active",
          header: "Status",
          options: [
            { value: "true", label: "Active" },
            { value: "false", label: "Inactive" },
          ],
        },
      ]}
      headerActions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {can(AppPermission.DELIVERY_ZONE.UPDATE) ? (
            <CustomButton variant="outline" leftIcon={ArrowUpDown} onClick={reorder}>
              Reorder
            </CustomButton>
          ) : null}
          <RouteButton path={AppRoute.DELIVERY_ZONE_NEW} permission={AppPermission.DELIVERY_ZONE.CREATE} leftIcon={Plus}>
            New zone
          </RouteButton>
        </div>
      }
      onRowClick={(row) => router.push(AppRoute.DELIVERY_ZONE(row._id))}
      emptyMessage="No delivery zones yet"
      emptyDescription="Add a zone with its areas and fee so customers can choose delivery."
      rowActions={[
        { label: "Edit", icon: Pencil, hidden: () => !can(AppPermission.DELIVERY_ZONE.UPDATE), onClick: (row) => router.push(AppRoute.DELIVERY_ZONE(row._id)) },
        {
          label: "Delete",
          icon: Trash2,
          destructive: true,
          hidden: () => !can(AppPermission.DELIVERY_ZONE.DELETE),
          confirm: (row) => ({
            title: `Delete ${row.name.en || row.name.ar || "this zone"}?`,
            description: "Customers can no longer choose it at checkout and it leaves this list. Orders already placed keep the fee and name they were charged.",
            confirmLabel: "Delete zone",
            destructive: true,
          }),
          onClick: async (row) => {
            if (await runAction(() => requester(deleteDeliveryZoneEndpoint, { params: { id: row._id } }), `${row.name.en || row.name.ar || "Zone"} deleted`)) {
              table.current?.refetch();
            }
          },
        },
      ]}
      columns={[
        {
          key: "name",
          header: "Zone",
          render: (row) => (
            <div className="flex min-w-0 max-w-[22rem] flex-col">
              <span dir="auto" className="truncate font-medium">
                {row.name.en || row.name.ar || "Untitled zone"}
              </span>
              {row.name.ar && row.name.en ? (
                <span dir="auto" className="truncate text-[13px] text-[var(--st-ink-muted)]">
                  {row.name.ar}
                </span>
              ) : null}
            </div>
          ),
        },
        { key: "areas", header: "Areas", render: (row) => <span className="st-figure whitespace-nowrap">{row.areas.length}</span> },
        { key: "fee", header: "Fee", render: (row) => <span className="st-figure whitespace-nowrap">{money(row.fee)}</span> },
        { key: "minimumOrder", header: "Minimum order", render: (row) =>
            row.minimumOrder === undefined || row.minimumOrder === null ? (
              <span className="text-[var(--st-ink-muted)]">Store-wide</span>
            ) : (
              <span className="st-figure whitespace-nowrap">{money(row.minimumOrder)}</span>
            ),
        },
        { key: "leadDays", header: "Lead time", render: (row) => <span className="whitespace-nowrap">{row.leadDays === 1 ? "1 day" : `${row.leadDays} days`}</span> },
        {
          key: "active",
          header: "Status",
          render: (row) => (
            <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: TONE_VAR[row.active ? "done" : "neutral"] }}>
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              {row.active ? "Active" : "Inactive"}
            </span>
          ),
        },
      ]}
    />
  );
}
