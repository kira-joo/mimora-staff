import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { createDeliveryZoneEndpoint } from "src/api/delivery-zones.endpoints";
import { DeliveryZoneForm } from "src/features/fulfilment/delivery-zone-form";

export const metadata: Metadata = { title: "New delivery zone" };

export default function NewDeliveryZonePage() {
  return (
    <PermissionGuard permission={AppPermission.DELIVERY_ZONE.CREATE} fallback={<NoAccess />}>
      <PageShell title="New delivery zone" backRoute={{ path: AppRoute.DELIVERY_ZONES, label: "Delivery zones" }}>
        <DeliveryZoneForm endpoint={createDeliveryZoneEndpoint} />
      </PageShell>
    </PermissionGuard>
  );
}
