"use client";

import { useAuthUserContext } from "@kira-joo/frontend-toolkit-core";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { ButtonLink, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useConfirm } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { InviteStaffInput, StaffInvitation, StaffMember, UpdateStaffInput, inviteStaffEndpoint, updateStaffEndpoint } from "src/api/staff.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { InvitationPanel } from "./invitation-panel";
import { RoleChecklist } from "./role-checklist";
import { buildInviteBody, buildUpdateBody, mapStaffToFormValues, sessionImpact, type StaffFormValues } from "./staff-helpers";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

function sections(isEdit: boolean, isSelf: boolean): FormSection<StaffFormValues>[] {
  return [
    {
      title: "Person",
      columns: 1,
      fields: [
        { type: FieldType.INPUT, name: "name", label: "Name", rules: { required: "Enter a name.", maxLength: { value: 120, message: "Use at most 120 characters." } } },
        {
          type: FieldType.INPUT,
          name: "email",
          label: "Email",
          inputType: "email",
          disabled: isEdit,
          description: isEdit ? "The email can't be changed." : "They sign in with this address.",
          rules: { required: "Enter an email address.", pattern: { value: EMAIL_PATTERN, message: "Enter a valid email address." } },
        },
      ],
    },
    {
      title: "Access",
      description: "What this person can see and do. Leave empty for an account with no access yet. The store always keeps at least one active Owner, so the last one can't be demoted or deactivated.",
      columns: 1,
      fields: [
        {
          type: FieldType.CUSTOM,
          name: "roleIds",
          render: ({ field, error }) => <RoleChecklist value={(field.value as string[]) ?? []} onChange={field.onChange} disabled={field.disabled} error={error} />,
        },
        ...(isEdit
          ? [
              {
                type: FieldType.SWITCH,
                name: "active",
                label: "Active",
                disabled: isSelf,
                description: isSelf ? "You can't deactivate your own account." : "A deactivated account can't sign in.",
              } as const,
            ]
          : []),
      ],
    },
  ];
}

export interface StaffFormProps {
  endpoint: typeof inviteStaffEndpoint | typeof updateStaffEndpoint;
  /** The member being edited; absent on the invite page. */
  oldData?: StaffMember;
}

/**
 * Invite (POST) or edit (PUT /:id). An edit sends only what changed, because the
 * API signs the person out whenever roles or `active` is present, and says so in
 * a confirm first. An invite replaces the form with the one-time invitation link.
 */
export function StaffForm({ endpoint, oldData }: StaffFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const user = useAuthUserContext() as { _id?: string } | null;
  const isEdit = Boolean(oldData);
  const isSelf = Boolean(oldData && user?._id === oldData._id);
  const form = useForm<StaffFormValues>({ defaultValues: mapStaffToFormValues(oldData) });
  const [issued, setIssued] = useState<{ name: string; invitation: StaffInvitation } | null>(null);

  if (issued) {
    return (
      <div className="flex flex-col gap-5 border border-[var(--st-line)] bg-[var(--st-surface)] p-5">
        <h2 className="text-[18px] font-semibold">Invitation created</h2>
        <InvitationPanel invitation={issued.invitation} name={issued.name} />
        <div>
          <ButtonLink href={AppRoute.TEAM}>Done</ButtonLink>
        </div>
      </div>
    );
  }

  /** A change that signs the person out (roles, deactivation) is confirmed first; anything else saves straight away. */
  async function confirmSessionImpact(values: StaffFormValues): Promise<boolean> {
    if (!oldData) return true;
    const impact = sessionImpact(buildUpdateBody(oldData, values));
    if (!impact) return true;
    return confirm({ title: impact.title(oldData.name), description: impact.description(oldData.name), confirmLabel: impact.confirmLabel, destructive: impact.destructive });
  }

  return (
    <CustomForm<StaffFormValues, typeof endpoint>
      form={form}
      mode={isEdit ? "edit" : "create"}
      sections={sections(isEdit, isSelf)}
      submitEndpoint={endpoint}
      submitParams={oldData ? { id: oldData._id } : undefined}
      transformValues={(values): InviteStaffInput & UpdateStaffInput => ((oldData ? buildUpdateBody(oldData, values) : buildInviteBody(values)) as InviteStaffInput & UpdateStaffInput)}
      confirmSubmit={confirmSessionImpact}
      submitButtonText={isEdit ? "Save changes" : "Send invitation"}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        void queryClient.invalidateQueries();
        if (isEdit) {
          toast.success("Changes saved");
          form.reset(mapStaffToFormValues(saved as StaffMember));
          router.push(AppRoute.TEAM);
        } else {
          const invited = saved as StaffMember & { invitation: StaffInvitation };
          form.reset(mapStaffToFormValues(invited));
          setIssued({ name: invited.name, invitation: invited.invitation });
        }
      }}
    />
  );
}
