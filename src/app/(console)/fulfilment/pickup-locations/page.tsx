import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { PickupLocationsTable } from "src/features/fulfilment/pickup-locations-table";

export const metadata: Metadata = { title: "Pickup locations" };

export default function PickupLocationsPage() {
  return (
    <PermissionGuard permission={AppPermission.PICKUP_LOCATION.READ} fallback={<NoAccess />}>
      <PageShell title="Pickup locations" description="Places customers can collect orders from.">
        <PickupLocationsTable />
      </PageShell>
    </PermissionGuard>
  );
}
