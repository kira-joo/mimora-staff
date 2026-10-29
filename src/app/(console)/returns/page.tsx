import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { ReturnsTable } from "src/features/returns/returns-table";

export const metadata: Metadata = { title: "Returns" };

export default function ReturnsPage() {
  return (
    <PermissionGuard permission={AppPermission.RETURN.READ} fallback={<NoAccess />}>
      <PageShell title="Returns" description="Return requests, newest first. Approve or reject, receive the goods, then record the refund.">
        <ReturnsTable />
      </PageShell>
    </PermissionGuard>
  );
}
