import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { DeliveryZoneEditView } from "src/features/fulfilment/delivery-zone-edit-view";

export const metadata: Metadata = { title: "Delivery zone" };

export default async function DeliveryZonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={AppPermission.DELIVERY_ZONE.READ_ONE} fallback={<NoAccess />}>
      <DeliveryZoneEditView id={id} />
    </PermissionGuard>
  );
}
