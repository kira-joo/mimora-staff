import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { BrandsTable } from "src/features/brands/brands-table";

export const metadata: Metadata = { title: "Brands" };

export default function BrandsPage() {
  return (
    <PermissionGuard permission={AppPermission.BRAND.READ} fallback={<NoAccess />}>
      <PageShell title="Brands" description="Group products by maker. Unpublished brands stay in the catalog but leave the storefront.">
        <BrandsTable />
      </PageShell>
    </PermissionGuard>
  );
}
