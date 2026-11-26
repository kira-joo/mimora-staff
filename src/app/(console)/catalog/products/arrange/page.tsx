import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { ArrangeProductsView } from "src/features/catalog/products/arrange-products-view";

export const metadata: Metadata = { title: "Arrange products" };

export default function ArrangeProductsPage() {
  return (
    <PermissionGuard permission={AppPermission.PRODUCT.UPDATE} fallback={<NoAccess />}>
      <ArrangeProductsView />
    </PermissionGuard>
  );
}
