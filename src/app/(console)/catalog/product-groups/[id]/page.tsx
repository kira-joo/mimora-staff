import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { ProductGroupView } from "src/features/catalog/product-groups/product-group-view";

export const metadata: Metadata = { title: "Product group" };

export default async function ProductGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={AppPermission.PRODUCT_GROUP.READ_ONE} fallback={<NoAccess />}>
      <ProductGroupView id={id} />
    </PermissionGuard>
  );
}
