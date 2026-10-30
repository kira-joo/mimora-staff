"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomButton, PageShell, QueryState } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { Mail } from "lucide-react";
import { getStaffEndpoint, updateStaffEndpoint } from "src/api/staff.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { StaffForm } from "./staff-form";
import { useResendInvite } from "./resend-invite";

export function StaffEditView({ id }: { id: string }) {
  const query = useRequesterQuery({ endpoint: getStaffEndpoint, options: { params: { id } }, queryOptions: { refetchOnMount: "always", refetchOnWindowFocus: false } });
  const resend = useResendInvite();
  return (
    <QueryState query={query} entityName="team member" backRoute={{ path: AppRoute.TEAM, label: "Team" }}>
      {(member) => (
        <PageShell
          title={<span dir="auto">{member.name}</span>}
          description={<bdi dir="ltr">{member.email}</bdi>}
          backRoute={{ path: AppRoute.TEAM, label: "Team" }}
        >
          <div className="flex flex-col gap-6">
            <StaffForm key={member.updatedAt} endpoint={updateStaffEndpoint} oldData={member} />
            {member.lastLoginAt ? null : (
              <section className="flex flex-col gap-2 border border-[var(--st-line)] bg-[var(--st-surface)] p-5">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--st-ink-muted)]">Invitation</h2>
                <p>This person hasn&apos;t signed in yet. If they lost the link or it expired, make a new one. The old link stops working.</p>
                <div>
                  <CustomButton type="button" variant="outline" leftIcon={Mail} onClick={() => void resend(member)}>
                    Resend invitation
                  </CustomButton>
                </div>
              </section>
            )}
          </div>
        </PageShell>
      )}
    </QueryState>
  );
}
