"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { getCategoryEndpoint, updateCategoryEndpoint } from "src/api/categories.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { displayName } from "../catalog-display";
import { CategoryForm } from "./category-form";
import { SubcategoriesPanel } from "./subcategories-panel";

export function CategoryEditView({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getCategoryEndpoint, options: { params: { id } } });
  return (
    <QueryState query={query} entityName="category" backRoute={{ path: AppRoute.CATEGORIES, label: "Categories" }}>
      {(category) => (
        <PageShell title={<span dir="auto">{displayName(category.name)}</span>} backRoute={{ path: AppRoute.CATEGORIES, label: "Categories" }} maxWidth="3xl">
          <div className="flex flex-col gap-6">
            <SubcategoriesPanel category={category} />
            <CategoryForm key={category.updatedAt} endpoint={updateCategoryEndpoint} oldData={category} />
          </div>
        </PageShell>
      )}
    </QueryState>
  );
}
