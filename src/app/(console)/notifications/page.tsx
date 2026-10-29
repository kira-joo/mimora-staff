import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { NotificationsPageView } from "src/features/notifications/notifications-page-view";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <PermissionGuard permission={CustomPermission.NOTIFICATION_READ} fallback={<NoAccess />}>
      <NotificationsPageView />
    </PermissionGuard>
  );
}
