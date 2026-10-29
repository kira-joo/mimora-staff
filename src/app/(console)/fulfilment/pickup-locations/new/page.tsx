import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { createPickupLocationEndpoint } from "src/api/pickup-locations.endpoints";
import { PickupLocationForm } from "src/features/fulfilment/pickup-location-form";

export const metadata: Metadata = { title: "New pickup location" };

export default function NewPickupLocationPage() {
  return (
    <PermissionGuard permission={AppPermission.PICKUP_LOCATION.CREATE} fallback={<NoAccess />}>
      <PageShell title="New pickup location" backRoute={{ path: AppRoute.PICKUP_LOCATIONS, label: "Pickup locations" }} maxWidth="3xl">
        <PickupLocationForm endpoint={createPickupLocationEndpoint} />
      </PageShell>
    </PermissionGuard>
  );
}
