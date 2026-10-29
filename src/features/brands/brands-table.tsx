"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { RouteButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { runAction } from "src/common/feedback/run-action";
import { FeatureTable, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { EyeOff, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { listBrandsEndpoint, unpublishBrandEndpoint, type Brand } from "src/api/brands.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { TONE_VAR } from "src/features/status/status-vocabulary";

/**
 * The list pattern every catalog list follows: URL-synced filters, sort and
 * page; row click opens the record; actions appear only for permissions the
 * role holds (the API checks them again); a destructive action is always
 * confirmed, and named for what it actually does — the API's DELETE
 * unpublishes, so this says "Unpublish", not "Delete".
 */
export function BrandsTable() {
  const router = useRouter();
  const can = usePermission();
  const table = useRef<FeatureTableHandle>(null);

  return (
    <FeatureTable<Brand>
      ref={table}
      endpoint={listBrandsEndpoint}
      entityName="brands"
      // No brand field is searchable server-side; filter by visibility instead.
      searchable={false}
      defaultLimit={25}
      filters={[
        {
          key: "published",
          header: "Visibility",
          options: [
            { value: "true", label: "Published" },
            { value: "false", label: "Unpublished" },
          ],
        },
      ]}
      headerActions={
        <RouteButton path={AppRoute.BRAND_NEW} permission={AppPermission.BRAND.CREATE} leftIcon={Plus}>
          New brand
        </RouteButton>
      }
      onRowClick={(row) => router.push(AppRoute.BRAND(row._id))}
      emptyMessage="No brands yet"
      emptyDescription="Create the first brand to group products under it."
      rowActions={[
        { label: "Edit", icon: Pencil, hidden: () => !can(AppPermission.BRAND.UPDATE), onClick: (row) => router.push(AppRoute.BRAND(row._id)) },
        {
          label: "Unpublish",
          icon: EyeOff,
          destructive: true,
          hidden: (row) => !row.published || !can(AppPermission.BRAND.DELETE),
          confirm: (row) => ({
            title: `Unpublish ${row.name.en || row.name.ar}?`,
            description: "It disappears from the storefront. Its products stay, and you can publish it again from its page.",
            confirmLabel: "Unpublish",
            destructive: true,
          }),
          onClick: async (row) => {
            if (await runAction(() => requester(unpublishBrandEndpoint, { params: { id: row._id } }), `${row.name.en || row.name.ar} unpublished`)) {
              table.current?.refetch();
            }
          },
        },
      ]}
      columns={[
        {
          key: "name",
          header: "Brand",
          render: (row) => (
            <div className="flex min-w-0 flex-col">
              <span dir="auto" className="truncate font-medium">
                {row.name.en || row.name.ar}
              </span>
              {row.name.ar && row.name.en ? (
                <span dir="auto" className="truncate text-[13px] text-[var(--st-ink-muted)]">
                  {row.name.ar}
                </span>
              ) : null}
            </div>
          ),
        },
        { key: "slug", header: "Slug", sortable: true, render: (row) => <span className="st-figure whitespace-nowrap">{row.slug}</span> },
        {
          key: "published",
          header: "Visibility",
          render: (row) => (
            <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: TONE_VAR[row.published ? "done" : "neutral"] }}>
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              {row.published ? "Published" : "Unpublished"}
            </span>
          ),
        },
      ]}
    />
  );
}
