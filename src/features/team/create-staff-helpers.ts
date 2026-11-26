import type { CreateStaffDirectInput } from "src/api/staff.endpoints";

/** Mirrors the API's staff password policy (`staff-password-policy.ts`); the server is the authority. */
export const STAFF_PASSWORD_MIN = 10;

export interface CreateStaffFormValues {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  mustChangePassword: boolean;
  roleIds: string[];
}

export function mapCreateDirectDefaults(): CreateStaffFormValues {
  return { name: "", email: "", password: "", confirmPassword: "", mustChangePassword: true, roleIds: [] };
}

/** The confirmation never leaves the browser; the password is sent as typed (never trimmed — spaces may be intended). */
export function buildCreateDirectBody(values: CreateStaffFormValues): CreateStaffDirectInput {
  return { name: values.name.trim(), email: values.email.trim(), password: values.password, roleIds: values.roleIds, mustChangePassword: values.mustChangePassword };
}
