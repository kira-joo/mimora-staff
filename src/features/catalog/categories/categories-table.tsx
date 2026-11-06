"use client";

import { requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomButton, RouteButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { FeatureTable, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { ArrowUpDown, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef } from "react";
import { deleteCategoryEndpoint, listCategoriesEndpoint, updateCategoryEndpoint, type Category } from "src/api/categories.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { LocalizedNameCell, VISIBILITY_FILTER, VisibilitySignal, displayName } from "../catalog-display";
import { siblingsOf } from "./category-tree";
import { reorderCategoryLevel } from "./reorder-categories";

/**
 * Categories in merchandising order (the API's default sort). Reorder works
 * within one level — the storefront orders siblings, not the whole tree.
 */
export function CategoriesTable() {
  const router = useRouter();
  const can = usePermission();
  const { openDialog } = useDialog();
  const table = useRef<FeatureTableHandle>(null);
  // Every category, for parent names and the reorder groups; 100 is the API's page maximum.
  const all = useRequesterQuery({ endpoint: listCategoriesEndpoint, options: { query: { limit: 100 } } });
  const byId = useMemo(() => new Map((all.data?.data ?? []).map((category) => [category._id, category])), [all.data]);

  function refresh() {
    void all.refetch();
    table.current?.refetch();
  }

  async function reorder() {
    const saved = await reorderCategoryLevel(
      openDialog,
      siblingsOf(all.data?.data ?? [], null),
      "Reorder top-level categories",
      "The storefront menu shows them in this order. Sub-categories are ordered from their parent's page.",
    );
    if (saved) {
      void all.refetch();
      table.current?.refetch();
    }
  }

  return (
    <FeatureTable<Category>
      ref={table}
      endpoint={listCategoriesEndpoint}
      entityName="categories"
      searchable={false}
      defaultLimit={25}
      filters={[VISIBILITY_FILTER]}
      headerActions={
        <div className="flex flex-wrap gap-2">
          {can(AppPermission.CATEGORY.UPDATE) ? (
            <CustomButton variant="outline" leftIcon={ArrowUpDown} onClick={reorder} disabled={!all.data}>
              Reorder
            </CustomButton>
          ) : null}
          <RouteButton path={AppRoute.CATEGORY_NEW} permission={AppPermission.CATEGORY.CREATE} leftIcon={Plus}>
            New category
          </RouteButton>
        </div>
      }
      onRowClick={(row) => router.push(AppRoute.CATEGORY(row._id))}
      emptyMessage="No categories yet"
      emptyDescription="Every product belongs to a category — create one first."
      rowActions={[
        { label: "Edit", icon: Pencil, hidden: () => !can(AppPermission.CATEGORY.UPDATE), onClick: (row) => router.push(AppRoute.CATEGORY(row._id)) },
        {
          label: "Publish",
          icon: Eye,
          hidden: (row) => row.published || !can(AppPermission.CATEGORY.UPDATE),
          onClick: async (row) => {
            if (await runAction(() => requester(updateCategoryEndpoint, { params: { id: row._id }, body: { published: true } }), `${displayName(row.name)} published`)) refresh();
          },
        },
        {
          label: "Unpublish",
          icon: EyeOff,
          hidden: (row) => !row.published || !can(AppPermission.CATEGORY.UPDATE),
          confirm: (row) => ({
            title: `Unpublish ${displayName(row.name)}?`,
            description: "It leaves the storefront menu. Its products and sub-categories stay, and you can publish it again at any time. A category with published sub-categories can't be unpublished — unpublish those first.",
            confirmLabel: "Unpublish",
          }),
          onClick: async (row) => {
            if (await runAction(() => requester(updateCategoryEndpoint, { params: { id: row._id }, body: { published: false } }), `${displayName(row.name)} unpublished`)) refresh();
          },
        },
        {
          label: "Delete",
          icon: Trash2,
          destructive: true,
          hidden: () => !can(AppPermission.CATEGORY.DELETE),
          confirm: (row) => ({
            title: `Delete ${displayName(row.name)}?`,
            description: "This can't be undone. A category that still has sub-categories or products, or that a promotion or the storefront content uses, can't be deleted — you'll be told what to move first. Nothing is reassigned automatically.",
            confirmLabel: "Delete",
            destructive: true,
          }),
          onClick: async (row) => {
            if (await runAction(() => requester(deleteCategoryEndpoint, { params: { id: row._id } }), `${displayName(row.name)} deleted`)) refresh();
          },
        },
      ]}
      columns={[
        { key: "name", header: "Category", render: (row) => <LocalizedNameCell name={row.name} /> },
        {
          key: "parentId",
          header: "Parent",
          render: (row) => {
            const parent = row.parentId ? byId.get(row.parentId) : undefined;
            return parent ? (
              <span dir="auto" className="truncate">
                {displayName(parent.name)}
              </span>
            ) : (
              <span className="text-[var(--st-ink-muted)]">Top level</span>
            );
          },
        },
        { key: "slug", header: "Slug", sortable: true, render: (row) => <span className="st-figure whitespace-nowrap">{row.slug}</span> },
        { key: "published", header: "Visibility", render: (row) => <VisibilitySignal published={row.published} /> },
      ]}
    />
  );
}
