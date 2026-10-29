import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { ProductEditView } from "src/features/catalog/products/product-edit-view";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={AppPermission.PRODUCT.READ_ONE} fallback={<NoAccess />}>
      <ProductEditView id={id} />
    </PermissionGuard>
  );
}
