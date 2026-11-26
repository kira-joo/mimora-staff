"use client";

import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import type { CreateStaffDirectInput, StaffMember, createStaffDirectEndpoint } from "src/api/staff.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { RoleChecklist } from "./role-checklist";
import { STAFF_PASSWORD_MIN, buildCreateDirectBody, mapCreateDirectDefaults, type CreateStaffFormValues } from "./create-staff-helpers";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

const sections: FormSection<CreateStaffFormValues>[] = [
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
        description: "They sign in with this address.",
        rules: { required: "Enter an email address.", pattern: { value: EMAIL_PATTERN, message: "Enter a valid email address." } },
      },
    ],
  },
  {
    title: "Password",
    description: "Share it with them privately. It is stored only as a secure hash and can't be shown again.",
    columns: 1,
    fields: [
      {
        type: FieldType.INPUT,
        name: "password",
        label: "Password",
        inputType: "password",
        description: `At least ${STAFF_PASSWORD_MIN} characters.`,
        rules: { required: "Enter a password.", minLength: { value: STAFF_PASSWORD_MIN, message: `Use at least ${STAFF_PASSWORD_MIN} characters.` }, maxLength: { value: 200, message: "Use at most 200 characters." } },
      },
      { type: FieldType.INPUT, name: "confirmPassword", label: "Confirm password", inputType: "password", rules: { required: "Enter the password again." } },
      {
        type: FieldType.SWITCH,
        name: "mustChangePassword",
        label: "Require a new password at first sign-in",
        description: "Recommended. Until they choose their own, they can't do anything else in the console.",
      },
    ],
  },
  {
    title: "Access",
    description: "What this person can see and do. You can only give roles within your own access.",
    columns: 1,
    fields: [
      {
        type: FieldType.CUSTOM,
        name: "roleIds",
        render: ({ field, error }) => <RoleChecklist value={(field.value as string[]) ?? []} onChange={field.onChange} disabled={field.disabled} error={error} />,
      },
    ],
  },
];

/** Creates an active account straight away, with a password the administrator sets. The invitation form is the alternative. */
export function CreateStaffForm({ endpoint }: { endpoint: typeof createStaffDirectEndpoint }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<CreateStaffFormValues>({ defaultValues: mapCreateDirectDefaults() });

  return (
    <CustomForm<CreateStaffFormValues, typeof endpoint>
      form={form}
      mode="create"
      sections={sections}
      submitEndpoint={endpoint}
      transformValues={(values): CreateStaffDirectInput => buildCreateDirectBody(values)}
      confirmSubmit={(values) => {
        if (values.password === values.confirmPassword) return true;
        form.setError("confirmPassword", { message: "The passwords don't match." });
        return false;
      }}
      submitButtonText="Create account"
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        void queryClient.invalidateQueries();
        form.reset(mapCreateDirectDefaults());
        toast.success(`Account created for ${(saved as StaffMember).name}`);
        router.push(AppRoute.TEAM_MEMBER((saved as StaffMember)._id));
      }}
    />
  );
}
