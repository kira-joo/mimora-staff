import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { SizeGuidesTable } from "src/features/catalog/size-guides/size-guides-table";

export const metadata: Metadata = { title: "Size guides" };

export default function SizeguidesPage() {
  return (
    <PermissionGuard permission={AppPermission.SIZE_GUIDE.READ} fallback={<NoAccess />}>
      <PageShell title="Size guides" description="Measurement charts shared by the products that link to them.">
        <SizeGuidesTable />
      </PageShell>
    </PermissionGuard>
  );
}
