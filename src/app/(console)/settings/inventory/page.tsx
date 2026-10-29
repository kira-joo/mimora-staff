import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { InventorySettingsView } from "src/features/settings/inventory-view";

export const metadata: Metadata = { title: "Inventory settings" };

export default function InventorySettingsPage() {
  return (
    <PermissionGuard permission={AppPermission.INVENTORY_SETTINGS.READ} fallback={<NoAccess />}>
      <InventorySettingsView />
    </PermissionGuard>
  );
}
