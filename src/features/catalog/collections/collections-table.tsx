"use client";

import { requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomButton, RouteButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { FeatureTable, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { ArrowUpDown, EyeOff, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { listCollectionsEndpoint, reorderCollectionsEndpoint, unpublishCollectionEndpoint, type Collection } from "src/api/collections.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { AppRoute } from "src/common/routes/app-route";
import { ReorderDialog } from "src/components/reorder-dialog";
import { usePermission } from "src/features/auth/use-permission";
import { LocalizedNameCell, VISIBILITY_FILTER, VisibilitySignal, displayName } from "../catalog-display";

/** Collections in merchandising order, the categories table's pattern without the tree. */
export function CollectionsTable() {
  const router = useRouter();
  const can = usePermission();
  const { openDialog } = useDialog();
  const table = useRef<FeatureTableHandle>(null);
  const all = useRequesterQuery({ endpoint: listCollectionsEndpoint, options: { query: { limit: 100 } } });

  async function reorder() {
    // The API lists collections by sortOrder already.
    const items = (all.data?.data ?? []).map((collection) => ({ id: collection._id, name: displayName(collection.name) }));
    const outcome = await openDialog<typeof ReorderDialog, boolean>({
      component: ReorderDialog,
      props: {
        title: "Reorder collections",
        description: "The storefront shows collections in this order.",
        items,
        save: (ids) => requester(reorderCollectionsEndpoint, { body: { items: ids.map((collectionId, sortOrder) => ({ collectionId, sortOrder })) } }),
      },
    }).result;
    if (outcome.status === "resolved") {
      void all.refetch();
      table.current?.refetch();
    }
  }

  return (
    <FeatureTable<Collection>
      ref={table}
      endpoint={listCollectionsEndpoint}
      entityName="collections"
      searchable={false}
      defaultLimit={25}
      filters={[VISIBILITY_FILTER]}
      headerActions={
        <div className="flex flex-wrap gap-2">
          {can(AppPermission.COLLECTION.UPDATE) ? (
            <CustomButton variant="outline" leftIcon={ArrowUpDown} onClick={reorder} disabled={(all.data?.data.length ?? 0) < 2}>
              Reorder
            </CustomButton>
          ) : null}
          <RouteButton path={AppRoute.COLLECTION_NEW} permission={AppPermission.COLLECTION.CREATE} leftIcon={Plus}>
            New collection
          </RouteButton>
        </div>
      }
      onRowClick={(row) => router.push(AppRoute.COLLECTION(row._id))}
      emptyMessage="No collections yet"
      emptyDescription="Collections group products across categories — a season, a campaign, a capsule."
      rowActions={[
        { label: "Edit", icon: Pencil, hidden: () => !can(AppPermission.COLLECTION.UPDATE), onClick: (row) => router.push(AppRoute.COLLECTION(row._id)) },
        {
          label: "Unpublish",
          icon: EyeOff,
          destructive: true,
          hidden: (row) => !row.published || !can(AppPermission.COLLECTION.DELETE),
          confirm: (row) => ({
            title: `Unpublish ${displayName(row.name)}?`,
            description: "It leaves the storefront. Its products stay, and you can publish it again from its page.",
            confirmLabel: "Unpublish",
            destructive: true,
          }),
          onClick: async (row) => {
            if (await runAction(() => requester(unpublishCollectionEndpoint, { params: { id: row._id } }), `${displayName(row.name)} unpublished`)) {
              table.current?.refetch();
            }
          },
        },
      ]}
      columns={[
        { key: "name", header: "Collection", render: (row) => <LocalizedNameCell name={row.name} /> },
        { key: "slug", header: "Slug", sortable: true, render: (row) => <span className="st-figure whitespace-nowrap">{row.slug}</span> },
        { key: "published", header: "Visibility", render: (row) => <VisibilitySignal published={row.published} /> },
      ]}
    />
  );
}
