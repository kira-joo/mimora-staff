import { MethodType, type Endpoint } from "@kira-joo/frontend-toolkit-core";

export interface OwnAccountRole {
  _id: string;
  name: string;
  grantsAll: boolean;
  isActive: boolean;
  permissions: Array<{ key: string; name: string; entity: string; action: string; isSystem: boolean }>;
}

/** The signed-in staff member's own account, as `/api/admin/account` answers it. */
export interface OwnAccount {
  _id: string;
  name: string;
  email: string;
  roles: OwnAccountRole[];
  grantsAll: boolean;
  /** Every permission the active roles grant — empty while a password change is pending. */
  effectivePermissions: string[];
  mustChangePassword: boolean;
  lastLoginAt?: string;
  createdAt?: string;
}

const ACCOUNT = "/admin/account";

export const getOwnAccountEndpoint: Endpoint<{ returnType: OwnAccount }> = {
  url: ACCOUNT,
  methodType: MethodType.GET,
};

export const updateOwnAccountEndpoint: Endpoint<{ body: { name: string }; returnType: OwnAccount }> = {
  url: ACCOUNT,
  methodType: MethodType.PUT,
};

/** Signs out every other session and re-issues this one's cookies. */
export const changeOwnPasswordEndpoint: Endpoint<{ body: { currentPassword: string; newPassword: string }; returnType: void }> = {
  url: `${ACCOUNT}/password`,
  methodType: MethodType.PUT,
};
