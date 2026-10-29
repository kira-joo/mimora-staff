import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { FulfilmentSettingsView } from "src/features/fulfilment/fulfilment-settings-view";

export const metadata: Metadata = { title: "Fulfilment settings" };

export default function FulfilmentSettingsPage() {
  return (
    <PermissionGuard permission={AppPermission.FULFILMENT_SETTINGS.READ} fallback={<NoAccess />}>
      <FulfilmentSettingsView />
    </PermissionGuard>
  );
}
