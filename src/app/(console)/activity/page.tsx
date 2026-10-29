import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { ActivityTable } from "src/features/activity/activity-table";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return (
    <PermissionGuard permission={CustomPermission.ACTIVITY_READ} fallback={<NoAccess />}>
      <PageShell title="Activity" description="Who changed what, and when — every audited action in the console, newest first.">
        <ActivityTable />
      </PageShell>
    </PermissionGuard>
  );
}
