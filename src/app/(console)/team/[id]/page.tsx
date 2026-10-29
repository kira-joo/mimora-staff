import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { StaffEditView } from "src/features/team/staff-edit-view";

export const metadata: Metadata = { title: "Team member" };

export default async function TeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PermissionGuard permission={CustomPermission.STAFF_MANAGE} fallback={<NoAccess />}>
      <StaffEditView id={id} />
    </PermissionGuard>
  );
}
