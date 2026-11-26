import type { OwnAccount } from "src/api/account.endpoints";
import type { MatrixPermission } from "src/features/team/permission-matrix-model";

export interface PasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export const EMPTY_PASSWORD_FORM: PasswordFormValues = { currentPassword: "", newPassword: "", confirmPassword: "" };

/** Every distinct permission the account's ACTIVE roles carry — the read-only matrix's rows. */
export function accountPermissions(account: OwnAccount): MatrixPermission[] {
  const byKey = new Map<string, MatrixPermission>();
  for (const role of account.roles) {
    if (!role.isActive) continue;
    for (const permission of role.permissions) byKey.set(permission.key, permission);
  }
  return [...byKey.values()];
}

/** A client-side check before the round trip; the server enforces the same rules. Returns a message per field. */
export function passwordProblems(values: PasswordFormValues, minLength: number): Partial<Record<keyof PasswordFormValues, string>> {
  const problems: Partial<Record<keyof PasswordFormValues, string>> = {};
  if (values.newPassword.length < minLength) problems.newPassword = `Use at least ${minLength} characters.`;
  else if (values.newPassword === values.currentPassword) problems.newPassword = "Choose a password different from the current one.";
  if (values.confirmPassword !== values.newPassword) problems.confirmPassword = "The passwords don't match.";
  return problems;
}
