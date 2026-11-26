"use client";

import { useAuthUserContext, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { listPermissionsEndpoint, type Role, type RoleInput, type createRoleEndpoint, type updateRoleEndpoint } from "src/api/roles.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import { PermissionMatrix } from "./permission-matrix";
import { buildCreateRoleBody, buildUpdateRoleBody, mapRoleToFormValues, type RoleFormValues } from "./role-helpers";

function sections(options: { isOwnerRole: boolean; canGrantAll: boolean; grantsAll: boolean; matrix: (field: { value: string[]; onChange: (keys: string[]) => void; disabled?: boolean }) => React.ReactNode }): FormSection<RoleFormValues>[] {
  return [
    {
      title: "Role",
      columns: 1,
      fields: [
        {
          type: FieldType.INPUT,
          name: "name",
          label: "Name",
          disabled: options.isOwnerRole,
          description: options.isOwnerRole ? "The Owner role can't be renamed." : "Shown on each team member's profile. Must be unique.",
          rules: { required: "Enter a role name.", maxLength: { value: 60, message: "Use at most 60 characters." } },
        },
        {
          type: FieldType.SWITCH,
          name: "isActive",
          label: "Active",
          disabled: options.isOwnerRole,
          description: options.isOwnerRole ? "The Owner role is always active." : "An inactive role gives its holders nothing until it is turned back on.",
        },
        {
          type: FieldType.SWITCH,
          name: "grantsAll",
          label: "Full access",
          disabled: options.isOwnerRole || !options.canGrantAll,
          description: options.isOwnerRole
            ? "The Owner role always has full access, including anything added later."
            : options.canGrantAll
              ? "Everything, including permissions added in future releases. The permissions below are then ignored."
              : "Only someone with full access can grant it.",
        },
      ],
    },
    {
      title: "Permissions",
      description: options.grantsAll
        ? "This role has full access, so it can do everything below and anything added later."
        : "Tick what this role may do. You can only grant permissions you have yourself. Changes apply to everyone with this role on their next action.",
      columns: 1,
      fields: [
        {
          type: FieldType.CUSTOM,
          name: "permissionKeys",
          render: ({ field }) => options.matrix({ value: (field.value as string[]) ?? [], onChange: field.onChange, disabled: field.disabled || options.grantsAll }),
        },
      ],
    },
  ];
}

export interface RoleFormProps {
  endpoint: typeof createRoleEndpoint | typeof updateRoleEndpoint;
  /** The role being edited; absent on the New role page. */
  oldData?: Role;
}

/** Create (POST) or edit (PUT /:id, only what changed). The server enforces every rule the form hints at. */
export function RoleForm({ endpoint, oldData }: RoleFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const can = usePermission();
  const user = useAuthUserContext();
  const canGrantAll = Boolean(user?.roles.some((role) => role.grantsAll));
  const isEdit = Boolean(oldData);
  const form = useForm<RoleFormValues>({ defaultValues: mapRoleToFormValues(oldData) });
  const grantsAll = useWatch({ control: form.control, name: "grantsAll" });
  const permissions = useRequesterQuery({ endpoint: listPermissionsEndpoint, options: {} });

  const matrix = ({ value, onChange, disabled }: { value: string[]; onChange: (keys: string[]) => void; disabled?: boolean }) => {
    if (permissions.isLoading) return <p className="text-[var(--st-ink-muted)]">Loading permissions…</p>;
    if (permissions.isError || !permissions.data) {
      return (
        <p role="alert" className="text-[var(--st-status-danger)]">
          Permissions couldn&apos;t be loaded. Reload the page to try again.
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {grantsAll ? (
          <p className="inline-flex items-center gap-1.5 font-medium" style={{ color: "var(--st-status-done)" }}>
            <ShieldCheck aria-hidden="true" className="size-4" /> Full access
          </p>
        ) : (
          <p className="text-[13px] text-[var(--st-ink-muted)]">{value.length} selected</p>
        )}
        <PermissionMatrix permissions={permissions.data.data} value={new Set(value)} onChange={(next) => onChange([...next].sort())} canGrant={can} disabled={disabled} />
      </div>
    );
  };

  return (
    <CustomForm<RoleFormValues, typeof endpoint>
      form={form}
      mode={isEdit ? "edit" : "create"}
      sections={sections({ isOwnerRole: Boolean(oldData?.isOwnerRole), canGrantAll, grantsAll, matrix })}
      submitEndpoint={endpoint}
      submitParams={oldData ? { id: oldData._id } : undefined}
      transformValues={(values): RoleInput => (oldData ? buildUpdateRoleBody(oldData, values) : buildCreateRoleBody(values)) as RoleInput}
      submitButtonText={isEdit ? "Save changes" : "Create role"}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        void queryClient.invalidateQueries();
        form.reset(mapRoleToFormValues(saved as Role));
        toast.success(isEdit ? "Role saved" : "Role created");
        router.push(AppRoute.ROLES);
      }}
    />
  );
}
