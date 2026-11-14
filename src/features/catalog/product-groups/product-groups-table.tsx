"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { modalPresentation, useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { FeatureTable, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { deleteProductGroupEndpoint, listProductGroupsEndpoint, type ProductGroup, type ProductGroupListItem } from "src/api/product-groups.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { LocalizedNameCell, displayName } from "../catalog-display";
import { CreateGroupDialog } from "./create-group-dialog";

/** Every product group with how many products it holds. Deleting a group never deletes its products. */
export function ProductGroupsTable() {
  const router = useRouter();
  const can = usePermission();
  const { openDialog } = useDialog();
  const table = useRef<FeatureTableHandle>(null);

  async function create() {
    const outcome = await openDialog<typeof CreateGroupDialog, ProductGroup>({
      component: CreateGroupDialog,
      props: {},
      presentation: modalPresentation({ size: "md" }),
    }).result;
    if (outcome.status === "resolved") router.push(AppRoute.PRODUCT_GROUP(outcome.value._id));
  }

  return (
    <FeatureTable<ProductGroupListItem>
      ref={table}
      endpoint={listProductGroupsEndpoint}
      entityName="product groups"
      searchable={false}
      defaultLimit={25}
      headerActions={
        can(AppPermission.PRODUCT_GROUP.CREATE) ? (
          <CustomButton leftIcon={Plus} onClick={() => void create()}>
            New group
          </CustomButton>
        ) : null
      }
      onRowClick={(row) => router.push(AppRoute.PRODUCT_GROUP(row._id))}
      emptyMessage="No product groups yet"
      emptyDescription="Create a group to offer separate products — the same item in several colours or designs — as alternatives on each other's product pages."
      rowActions={[
        {
          label: "Delete group",
          icon: Trash2,
          destructive: true,
          hidden: () => !can(AppPermission.PRODUCT_GROUP.DELETE),
          confirm: (row) => ({
            title: `Delete ${displayName(row.name)}?`,
            description: `Its ${row.memberCount} product${row.memberCount === 1 ? "" : "s"} are kept exactly as they are — they just stop being offered as alternatives to each other.`,
            confirmLabel: "Delete group",
            destructive: true,
          }),
          onClick: async (row) => {
            if (await runAction(() => requester(deleteProductGroupEndpoint, { params: { id: row._id } }), `${displayName(row.name)} deleted`)) table.current?.refetch();
          },
        },
      ]}
      columns={[
        { key: "name", header: "Group", render: (row) => <LocalizedNameCell name={row.name} /> },
        { key: "memberCount", header: "Products", render: (row) => <span className="st-figure">{row.memberCount}</span> },
      ]}
    />
  );
}
