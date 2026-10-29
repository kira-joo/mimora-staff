"use client";

import { requester, useAuthUserContext } from "@kira-joo/frontend-toolkit-core";
import { RouteButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { FeatureTable, type FeatureTableHandle } from "@kira-joo/frontend-toolkit-tailwind/table";
import { Check, Mail, Pencil, Plus, Slash, UserCheck, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { listStaffEndpoint, updateStaffEndpoint, type StaffMember } from "src/api/staff.endpoints";
import { CustomPermission } from "src/common/authorization/authorization-registry";
import { runAction } from "src/common/feedback/run-action";
import { useStoreFormat } from "src/common/format/store-format";
import { AppRoute } from "src/common/routes/app-route";
import { TONE_VAR } from "src/features/status/status-vocabulary";
import { sessionImpact } from "./staff-helpers";
import { useResendInvite } from "./resend-invite";

function ActiveSignal({ active }: { active: boolean }) {
  const Icon = active ? Check : Slash;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium" style={{ color: TONE_VAR[active ? "done" : "neutral"] }}>
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
      {active ? "Active" : "Deactivated"}
    </span>
  );
}

/** Staff list: search by name or email. Deactivate and activate are the API's PUT (there is no delete), and deactivating confirms the sign-out. */
export function TeamTable() {
  const router = useRouter();
  const format = useStoreFormat();
  const table = useRef<FeatureTableHandle>(null);
  const resend = useResendInvite();
  const user = useAuthUserContext() as { _id?: string } | null;

  return (
    <FeatureTable<StaffMember>
      ref={table}
      endpoint={listStaffEndpoint}
      entityName="team members"
      searchPlaceholder="Search name or email"
      defaultLimit={25}
      headerActions={
        <RouteButton path={AppRoute.TEAM_INVITE} permission={CustomPermission.STAFF_MANAGE} leftIcon={Plus}>
          Invite member
        </RouteButton>
      }
      onRowClick={(row) => router.push(AppRoute.TEAM_MEMBER(row._id))}
      emptyMessage="No team members match"
      rowActions={[
        { label: "Edit", icon: Pencil, onClick: (row) => router.push(AppRoute.TEAM_MEMBER(row._id)) },
        {
          label: "Resend invitation",
          icon: Mail,
          hidden: (row) => Boolean(row.lastLoginAt),
          onClick: async (row) => {
            await resend(row);
          },
        },
        {
          label: "Deactivate",
          icon: UserX,
          destructive: true,
          hidden: (row) => !row.active || row._id === user?._id,
          confirm: (row) => {
            const impact = sessionImpact({ active: false })!;
            return { title: impact.title(row.name), description: impact.description(row.name), confirmLabel: impact.confirmLabel, destructive: true };
          },
          onClick: async (row) => {
            if (await runAction(() => requester(updateStaffEndpoint, { params: { id: row._id }, body: { active: false } }), `${row.name} deactivated`)) table.current?.refetch();
          },
        },
        {
          label: "Reactivate",
          icon: UserCheck,
          hidden: (row) => row.active,
          onClick: async (row) => {
            if (await runAction(() => requester(updateStaffEndpoint, { params: { id: row._id }, body: { active: true } }), `${row.name} reactivated`)) table.current?.refetch();
          },
        },
      ]}
      columns={[
        {
          key: "name",
          header: "Member",
          render: (row) => (
            <div className="flex min-w-0 flex-col">
              <span dir="auto" className="truncate font-medium">
                {row.name}
              </span>
              <bdi dir="ltr" className="truncate text-[13px] text-[var(--st-ink-muted)]">
                {row.email}
              </bdi>
            </div>
          ),
        },
        {
          key: "roles",
          header: "Roles",
          render: (row) => (row.roles.length ? <span dir="auto">{row.roles.map((role) => role.name).join(", ")}</span> : <span className="text-[var(--st-ink-muted)]">No role</span>),
        },
        { key: "active", header: "Status", render: (row) => <ActiveSignal active={row.active} /> },
        {
          key: "lastLoginAt",
          header: "Last sign-in",
          render: (row) => (row.lastLoginAt ? <span className="whitespace-nowrap">{format.dateTime(row.lastLoginAt)}</span> : <span className="text-[var(--st-ink-muted)]">Never signed in</span>),
        },
      ]}
    />
  );
}
