"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import type { useDialog } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { reorderCategoriesEndpoint, type Category } from "src/api/categories.endpoints";
import { ReorderDialog } from "src/components/reorder-dialog";
import { displayName } from "../catalog-display";
import { reorderItems } from "./category-tree";

/** Opens the reorder dialog for one level of siblings; resolves `true` once saved. */
export async function reorderCategoryLevel(openDialog: ReturnType<typeof useDialog>["openDialog"], siblings: Category[], title: string, description: string) {
  const outcome = await openDialog<typeof ReorderDialog, boolean>({
    component: ReorderDialog,
    props: {
      title,
      description,
      items: siblings.map((category) => ({ id: category._id, name: displayName(category.name) })),
      save: (ids) => requester(reorderCategoriesEndpoint, { body: { items: reorderItems(ids) } }),
    },
  }).result;
  return outcome.status === "resolved";
}
