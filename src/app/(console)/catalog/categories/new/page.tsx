import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { createCategoryEndpoint } from "src/api/categories.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { CategoryForm } from "src/features/catalog/categories/category-form";

export const metadata: Metadata = { title: "New category" };

export default function NewCategoryPage() {
  return (
    <PermissionGuard permission={AppPermission.CATEGORY.CREATE} fallback={<NoAccess />}>
      <PageShell title="New category" backRoute={{ path: AppRoute.CATEGORIES, label: "Categories" }} maxWidth="3xl">
        <CategoryForm endpoint={createCategoryEndpoint} />
      </PageShell>
    </PermissionGuard>
  );
}
