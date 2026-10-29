"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { RouteButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { FeatureTable, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { EyeOff, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { listPagesEndpoint, unpublishPageEndpoint, type ContentPage } from "src/api/pages.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { displayName, LocalizedNameCell, VISIBILITY_FILTER, VisibilitySignal } from "src/features/catalog/catalog-display";
import { LegalPagesPanel } from "./legal-pages-panel";

export function PagesTable() {
  const router = useRouter();
  const can = usePermission();
  const table = useRef<FeatureTableHandle>(null);
  const { dateTime } = useStoreFormat();

  return (
    <>
      <LegalPagesPanel onChanged={() => table.current?.refetch()} />
      <FeatureTable<ContentPage>
        ref={table}
        endpoint={listPagesEndpoint}
        entityName="pages"
        searchable={false}
        defaultLimit={25}
        filters={[VISIBILITY_FILTER]}
        headerActions={
          <RouteButton path={AppRoute.PAGE_NEW} permission={AppPermission.PAGE.CREATE} leftIcon={Plus}>
            New page
          </RouteButton>
        }
        onRowClick={(row) => router.push(AppRoute.PAGE(row._id))}
        emptyMessage="No pages yet"
        emptyDescription="Create the first page, such as About or Shipping policy."
        rowActions={[
          { label: "Edit", icon: Pencil, hidden: () => !can(AppPermission.PAGE.UPDATE), onClick: (row) => router.push(AppRoute.PAGE(row._id)) },
          {
            label: "Unpublish",
            icon: EyeOff,
            destructive: true,
            hidden: (row) => !row.published || !can(AppPermission.PAGE.DELETE),
            confirm: (row) => ({
              title: `Unpublish ${displayName(row.title) || row.slug}?`,
              description: "It disappears from the storefront. The page is kept, and you can publish it again from its page.",
              confirmLabel: "Unpublish",
              destructive: true,
            }),
            onClick: async (row) => {
              if (await runAction(() => requester(unpublishPageEndpoint, { params: { id: row._id } }), "Page unpublished")) table.current?.refetch();
            },
          },
        ]}
        columns={[
          { key: "title", header: "Page", render: (row) => <LocalizedNameCell name={row.title} /> },
          { key: "slug", header: "Slug", sortable: true, render: (row) => <span className="st-figure whitespace-nowrap">{row.slug}</span> },
          { key: "published", header: "Visibility", render: (row) => <VisibilitySignal published={row.published} /> },
          { key: "updatedAt", header: "Updated", render: (row) => <span className="whitespace-nowrap text-[13px]">{dateTime(row.updatedAt ?? row.createdAt)}</span> },
        ]}
      />
    </>
  );
}
