import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { CatalogImportDetail } from "src/features/catalog-import/catalog-import-detail";

export const metadata: Metadata = { title: "Import preview" };

export default async function CatalogImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={AppPermission.CATALOG_IMPORT_BATCH.READ_ONE} fallback={<NoAccess />}>
      <CatalogImportDetail id={id} />
    </PermissionGuard>
  );
}
