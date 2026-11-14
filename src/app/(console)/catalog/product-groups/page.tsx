import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { ProductGroupsTable } from "src/features/catalog/product-groups/product-groups-table";

export const metadata: Metadata = { title: "Product groups" };

export default function ProductGroupsPage() {
  return (
    <PermissionGuard permission={AppPermission.PRODUCT_GROUP.READ} fallback={<NoAccess />}>
      <PageShell title="Product groups" description="Separate products that are versions of one item — each keeps its own page, price and stock, and customers can switch between them.">
        <ProductGroupsTable />
      </PageShell>
    </PermissionGuard>
  );
}
