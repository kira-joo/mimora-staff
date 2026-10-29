import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { OperatingHoursView } from "src/features/fulfilment/operating-hours-view";

export const metadata: Metadata = { title: "Operating hours" };

export default function OperatingHoursPage() {
  return (
    <PermissionGuard permission={AppPermission.OPERATING_HOURS.READ} fallback={<NoAccess />}>
      <OperatingHoursView />
    </PermissionGuard>
  );
}
