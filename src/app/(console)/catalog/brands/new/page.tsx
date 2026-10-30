import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { createBrandEndpoint } from "src/api/brands.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { BrandForm } from "src/features/brands/brand-form";

export const metadata: Metadata = { title: "New brand" };

export default function NewBrandPage() {
  return (
    <PermissionGuard permission={AppPermission.BRAND.CREATE} fallback={<NoAccess />}>
      <PageShell title="New brand" backRoute={{ path: AppRoute.BRANDS, label: "Brands" }}>
        <BrandForm endpoint={createBrandEndpoint} />
      </PageShell>
    </PermissionGuard>
  );
}
