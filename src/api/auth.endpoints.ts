import { MethodType, type Endpoint } from "@kira-joo/frontend-toolkit-core";

/** The signed-in staff member, as the session endpoints answer it. */
export interface StaffIdentity {
  _id: string;
  name?: string;
  email?: string;
  tokenVersion?: number;
  roles: Array<{ name: string; grantsAll: boolean; permissions: string[] }>;
}

const AUTH = "/admin/auth";

export const loginEndpoint: Endpoint<{ body: { email: string; password: string }; returnType: StaffIdentity }> = {
  url: `${AUTH}/login`,
  methodType: MethodType.POST,
};

/** Under the refresh cookie's path prefix — the only reason the browser sends that cookie. */
export const refreshSessionEndpoint: Endpoint<{ returnType: StaffIdentity }> = {
  url: `${AUTH}/token/refresh`,
  methodType: MethodType.POST,
};

export const logoutEndpoint: Endpoint<{ returnType: void }> = {
  url: `${AUTH}/token/logout`,
  methodType: MethodType.POST,
};

export const acceptInviteEndpoint: Endpoint<{ body: { token: string; password: string }; returnType: void }> = {
  url: `${AUTH}/accept-invite`,
  methodType: MethodType.POST,
};
