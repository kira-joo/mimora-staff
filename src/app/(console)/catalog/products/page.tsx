import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { ProductsTable } from "src/features/catalog/products/products-table";

export const metadata: Metadata = { title: "Products" };

export default function ProductsPage() {
  return (
    <PermissionGuard permission={AppPermission.PRODUCT.READ} fallback={<NoAccess />}>
      <PageShell title="Products" description="What the store sells. Each product's variants carry its prices and stock; only published products reach the storefront.">
        <ProductsTable />
      </PageShell>
    </PermissionGuard>
  );
}
