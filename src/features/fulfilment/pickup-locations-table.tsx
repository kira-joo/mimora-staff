"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton, RouteButton, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { FeatureTable, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { ArrowUpDown, EyeOff, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { deactivatePickupLocationEndpoint, listPickupLocationsEndpoint, reorderPickupLocationsEndpoint, type PickupLocation } from "src/api/pickup-locations.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { AppRoute } from "src/common/routes/app-route";
import { ReorderDialog } from "src/components/reorder-dialog";
import { usePermission } from "src/features/auth/use-permission";
import { TONE_VAR } from "src/features/status/status-vocabulary";
import { toOrderEntries } from "./fulfilment-values";

/** Locations in storefront order. The API's DELETE deactivates, so the row action says "Deactivate"; reactivating is the edit form's Active switch. */
export function PickupLocationsTable() {
  const router = useRouter();
  const can = usePermission();
  const { openDialog } = useDialog();
  const table = useRef<FeatureTableHandle>(null);

  async function reorder() {
    // The reorder endpoint takes the whole order, so every location must be loaded (the API caps a page at 100).
    let page;
    try {
      page = await requester(listPickupLocationsEndpoint, { query: { limit: 100 } });
    } catch {
      toast.error("Could not load the locations to reorder. Try again.");
      return;
    }
    if (page.total > page.data.length) {
      toast.error(`There are ${page.total} locations; only ${page.data.length} can be reordered here.`);
      return;
    }
    const handle = openDialog({
      component: ReorderDialog,
      props: {
        title: "Reorder pickup locations",
        description: "Locations appear to customers in this order.",
        items: page.data.map((location) => ({
          id: location._id,
          name: location.name.en || location.name.ar || "Untitled location",
          label: <span dir="auto">{location.name.en || location.name.ar || "Untitled location"}</span>,
        })),
        save: (ids: string[]) => requester(reorderPickupLocationsEndpoint, { body: { items: toOrderEntries(ids).map((e) => ({ locationId: e.id, order: e.order })) } }),
      },
    });
    const outcome = await handle.result;
    if (outcome.status === "resolved") table.current?.refetch();
  }

  return (
    <FeatureTable<PickupLocation>
      ref={table}
      endpoint={listPickupLocationsEndpoint}
      entityName="pickup locations"
      // Locations are always in storefront order, and the list is short: no search or sort.
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
          {can(AppPermission.PICKUP_LOCATION.UPDATE) ? (
            <CustomButton variant="outline" leftIcon={ArrowUpDown} onClick={reorder}>
              Reorder
            </CustomButton>
          ) : null}
          <RouteButton path={AppRoute.PICKUP_LOCATION_NEW} permission={AppPermission.PICKUP_LOCATION.CREATE} leftIcon={Plus}>
            New location
          </RouteButton>
        </div>
      }
      onRowClick={(row) => router.push(AppRoute.PICKUP_LOCATION(row._id))}
      emptyMessage="No pickup locations yet"
      emptyDescription="Add a place customers can collect orders from."
      rowActions={[
        { label: "Edit", icon: Pencil, hidden: () => !can(AppPermission.PICKUP_LOCATION.UPDATE), onClick: (row) => router.push(AppRoute.PICKUP_LOCATION(row._id)) },
        {
          label: "Deactivate",
          icon: EyeOff,
          destructive: true,
          hidden: (row) => !row.active || !can(AppPermission.PICKUP_LOCATION.DELETE),
          confirm: (row) => ({
            title: `Deactivate ${row.name.en || row.name.ar || "this location"}?`,
            description: "Customers can no longer choose it at checkout. The record stays, and you can switch it back on from its page.",
            confirmLabel: "Deactivate",
            destructive: true,
          }),
          onClick: async (row) => {
            if (await runAction(() => requester(deactivatePickupLocationEndpoint, { params: { id: row._id } }), `${row.name.en || row.name.ar || "Location"} deactivated`)) {
              table.current?.refetch();
            }
          },
        },
      ]}
      columns={[
        {
          key: "name",
          header: "Location",
          render: (row) => (
            <div className="flex min-w-0 max-w-[22rem] flex-col">
              <span dir="auto" className="truncate font-medium">
                {row.name.en || row.name.ar || "Untitled location"}
              </span>
              {row.name.ar && row.name.en ? (
                <span dir="auto" className="truncate text-[13px] text-[var(--st-ink-muted)]">
                  {row.name.ar}
                </span>
              ) : null}
            </div>
          ),
        },
        {
          key: "address",
          header: "Address",
          render: (row) => (
            <span dir="auto" className="block max-w-[22rem] truncate">
              {row.address.en || row.address.ar}
            </span>
          ),
        },
        {
          key: "phone",
          header: "Phone",
          render: (row) => (
            <bdi dir="ltr" className="st-figure whitespace-nowrap">
              {row.phone}
            </bdi>
          ),
        },
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
