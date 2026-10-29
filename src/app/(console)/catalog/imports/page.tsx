import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { CatalogImportsView } from "src/features/catalog-import/catalog-imports-view";

export const metadata: Metadata = { title: "Bulk import" };

export default function CatalogImportsPage() {
  return (
    <PermissionGuard permission={AppPermission.CATALOG_IMPORT_BATCH.READ} fallback={<NoAccess />}>
      <PageShell title="Bulk import" description="Add or update many products from a spreadsheet. A file is checked and previewed first; nothing goes live until you publish it.">
        <CatalogImportsView />
      </PageShell>
    </PermissionGuard>
  );
}
