import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { CustomersTable } from "src/features/customers/customers-table";
import { ExportCsvButton } from "src/features/exports/export-csv-button";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <PermissionGuard permission={AppPermission.CUSTOMER.READ} fallback={<NoAccess />}>
      <PageShell
        title="Customers"
        description="People with a storefront account. Open one to see their consent and to export, recover or delete their data."
        actions={<ExportCsvButton kind="customers" readPermission={AppPermission.CUSTOMER.READ} exportPermission={CustomPermission.CUSTOMER_EXPORT} label="Export CSV" />}
      >
        <CustomersTable />
      </PageShell>
    </PermissionGuard>
  );
}
