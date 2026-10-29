import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { CategoryEditView } from "src/features/catalog/categories/category-edit-view";

export const metadata: Metadata = { title: "Category" };

export default async function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={AppPermission.CATEGORY.READ_ONE} fallback={<NoAccess />}>
      <CategoryEditView id={id} />
    </PermissionGuard>
  );
}
