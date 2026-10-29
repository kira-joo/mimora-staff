import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { ExportCsvButton } from "src/features/exports/export-csv-button";
import { InventoryTable } from "src/features/inventory/inventory-table";

export const metadata: Metadata = { title: "Inventory" };

export default function InventoryPage() {
  return (
    <PermissionGuard permission={AppPermission.VARIANT.READ} fallback={<NoAccess />}>
      <PageShell
        title="Inventory"
        description="Stock for every variant. Filter to what is running low or out, and adjust counts here."
        actions={<ExportCsvButton kind="inventory" readPermission={AppPermission.VARIANT.READ} exportPermission={CustomPermission.INVENTORY_EXPORT} label="Export CSV" />}
      >
        <InventoryTable />
      </PageShell>
    </PermissionGuard>
  );
}
