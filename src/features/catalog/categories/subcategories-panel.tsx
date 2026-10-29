"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { listCategoriesEndpoint, type Category } from "src/api/categories.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { VisibilitySignal, displayName } from "../catalog-display";
import { siblingsOf } from "./category-tree";
import { reorderCategoryLevel } from "./reorder-categories";

/** A category's direct children, in storefront order, with their own reorder. Hidden when it has none. */
export function SubcategoriesPanel({ category }: { category: Category }) {
  const can = usePermission();
  const { openDialog } = useDialog();
  const query = useRequesterQuery({ endpoint: listCategoriesEndpoint, options: { query: { parentId: category._id, limit: 100 } } });
  const children = siblingsOf(query.data?.data ?? [], category._id);
  if (children.length === 0) return null;

  async function reorder() {
    const saved = await reorderCategoryLevel(openDialog, children, `Reorder sub-categories of ${displayName(category.name)}`, "The storefront lists them under this category in this order.");
    if (saved) void query.refetch();
  }

  return (
    <section aria-labelledby="subcategories-heading" className="rounded-md border border-[var(--st-line)] bg-[var(--st-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--st-line)] px-4 py-3">
        <h2 id="subcategories-heading" className="text-[13px] font-semibold uppercase tracking-wide text-[var(--st-ink-muted)]">
          Sub-categories ({children.length})
        </h2>
        {can(AppPermission.CATEGORY.UPDATE) && children.length > 1 ? (
          <CustomButton variant="outline" leftIcon={ArrowUpDown} onClick={reorder}>
            Reorder
          </CustomButton>
        ) : null}
      </header>
      <ol className="divide-y divide-[var(--st-line)]">
        {children.map((child) => (
          <li key={child._id}>
            <Link href={AppRoute.CATEGORY(child._id)} className="flex min-h-12 items-center justify-between gap-3 px-4 hover:bg-[var(--st-accent-soft)]">
              <span dir="auto" className="min-w-0 truncate font-medium">
                {displayName(child.name)}
              </span>
              <VisibilitySignal published={child.published} />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
