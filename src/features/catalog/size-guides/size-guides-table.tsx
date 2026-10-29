"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { RouteButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { FeatureTable, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { deleteSizeGuideEndpoint, listSizeGuidesEndpoint, type SizeGuide } from "src/api/size-guides.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { LocalizedNameCell, displayName } from "../catalog-display";
import { readChart } from "./size-chart";

export function SizeGuidesTable() {
  const router = useRouter();
  const can = usePermission();
  const table = useRef<FeatureTableHandle>(null);

  return (
    <FeatureTable<SizeGuide>
      ref={table}
      endpoint={listSizeGuidesEndpoint}
      entityName="size guides"
      searchable={false}
      defaultLimit={25}
      headerActions={
        <RouteButton path={AppRoute.SIZE_GUIDE_NEW} permission={AppPermission.SIZE_GUIDE.CREATE} leftIcon={Plus}>
          New size guide
        </RouteButton>
      }
      onRowClick={(row) => router.push(AppRoute.SIZE_GUIDE(row._id))}
      emptyMessage="No size guides yet"
      emptyDescription="A size guide is a chart of measurements, shared by every product that links to it."
      rowActions={[
        { label: "Edit", icon: Pencil, hidden: () => !can(AppPermission.SIZE_GUIDE.UPDATE), onClick: (row) => router.push(AppRoute.SIZE_GUIDE(row._id)) },
        {
          label: "Delete",
          icon: Trash2,
          destructive: true,
          hidden: () => !can(AppPermission.SIZE_GUIDE.DELETE),
          confirm: (row) => ({
            title: `Delete ${displayName(row.name)}?`,
            description: "This removes the guide for good. A guide that products still use can't be deleted — the refusal says how many, and you detach them first.",
            confirmLabel: "Delete guide",
            destructive: true,
          }),
          onClick: async (row) => {
            if (await runAction(() => requester(deleteSizeGuideEndpoint, { params: { id: row._id } }), `${displayName(row.name)} deleted`)) {
              table.current?.refetch();
            }
          },
        },
      ]}
      columns={[
        { key: "name", header: "Size guide", render: (row) => <LocalizedNameCell name={row.name} /> },
        {
          key: "chartData",
          header: "Sizes",
          render: (row) => {
            const sizes = readChart(row.chartData).rows.map((cells) => cells[0]).filter(Boolean);
            return sizes.length ? (
              <span dir="auto" className="truncate">
                {sizes.join(" · ")}
              </span>
            ) : (
              <span className="text-[var(--st-ink-muted)]">No sizes</span>
            );
          },
        },
      ]}
    />
  );
}
