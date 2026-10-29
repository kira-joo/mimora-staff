import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { CategoriesTable } from "src/features/catalog/categories/categories-table";

export const metadata: Metadata = { title: "Categories" };

export default function CategoriesPage() {
  return (
    <PermissionGuard permission={AppPermission.CATEGORY.READ} fallback={<NoAccess />}>
      <PageShell title="Categories" description="Organise the catalog for browsing. Unpublished categories leave the storefront menu; their products stay.">
        <CategoriesTable />
      </PageShell>
    </PermissionGuard>
  );
}
