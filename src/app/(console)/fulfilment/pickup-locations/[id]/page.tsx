import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { PickupLocationEditView } from "src/features/fulfilment/pickup-location-edit-view";

export const metadata: Metadata = { title: "Pickup location" };

export default async function PickupLocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={AppPermission.PICKUP_LOCATION.READ_ONE} fallback={<NoAccess />}>
      <PickupLocationEditView id={id} />
    </PermissionGuard>
  );
}
