import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { DeliveryZonesTable } from "src/features/fulfilment/delivery-zones-table";

export const metadata: Metadata = { title: "Delivery zones" };

export default function DeliveryZonesPage() {
  return (
    <PermissionGuard permission={AppPermission.DELIVERY_ZONE.READ} fallback={<NoAccess />}>
      <PageShell title="Delivery zones" description="Where the store delivers, what each zone costs, and how long it takes.">
        <DeliveryZonesTable />
      </PageShell>
    </PermissionGuard>
  );
}
