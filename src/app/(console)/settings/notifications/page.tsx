import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { NotificationSettingsView } from "src/features/settings/notification-view";

export const metadata: Metadata = { title: "Notification settings" };

export default function NotificationSettingsPage() {
  return (
    <PermissionGuard permission={AppPermission.NOTIFICATION_SETTINGS.READ} fallback={<NoAccess />}>
      <NotificationSettingsView />
    </PermissionGuard>
  );
}
