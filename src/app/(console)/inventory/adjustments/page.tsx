import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { MovementsTable } from "src/features/inventory/movements-table";

export const metadata: Metadata = { title: "Adjustments log" };

export default function AdjustmentsLogPage() {
  return (
    <PermissionGuard permission={AppPermission.STOCK_MOVEMENT.READ} fallback={<NoAccess />}>
      <PageShell title="Adjustments log" description="Every change to a variant's stock: sales, cancellations, returns, receipts, damage and corrections. Newest first.">
        <MovementsTable />
      </PageShell>
    </PermissionGuard>
  );
}
