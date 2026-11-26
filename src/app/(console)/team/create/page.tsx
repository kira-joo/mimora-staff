import { PageShell, PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import Link from "next/link";
import { createStaffDirectEndpoint } from "src/api/staff.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { NoAccess } from "src/components/no-access";
import { CreateStaffForm } from "src/features/team/create-staff-form";

export const metadata: Metadata = { title: "Create account" };

export default function CreateStaffPage() {
  return (
    <PermissionGuard permission={AppPermission.STAFF_USER.CREATE} fallback={<NoAccess />}>
      <PageShell
        title="Create account"
        description={
          <>
            Set up an account with a password you choose — it works straight away. Prefer they choose their own?{" "}
            <Link href={AppRoute.TEAM_INVITE} className="font-medium text-[var(--st-accent)] underline underline-offset-2">
              Invite them instead
            </Link>
            .
          </>
        }
        backRoute={{ path: AppRoute.TEAM, label: "Team" }}
      >
        <CreateStaffForm endpoint={createStaffDirectEndpoint} />
      </PageShell>
    </PermissionGuard>
  );
}
