import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";

/** A role as embedded in a staff record: its permissions are bare ids here (the roles list carries them populated). */
export interface StaffRole {
  _id: string;
  name: string;
  grantsAll: boolean;
  isActive: boolean;
}

/** `passwordHash` and the invitation hash never leave the API (`select: false`). */
export interface StaffMember {
  _id: string;
  name: string;
  email: string;
  roles: StaffRole[];
  active: boolean;
  /** Absent until the first sign-in. */
  lastLoginAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** The one-time invitation token. It is returned once and only its hash is stored. */
export interface StaffInvitation {
  token: string;
  expiresAt: string;
}

export interface InviteStaffInput {
  name: string;
  email: string;
  roleIds?: string[];
}

/** Every field is optional; a roleIds or active field — even unchanged — signs the person out, so send only what changed. */
export interface UpdateStaffInput {
  name?: string;
  roleIds?: string[];
  active?: boolean;
}

export interface ListStaffQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  [key: string]: unknown;
}

const STAFF = "/admin/staff";

export const listStaffEndpoint: Endpoint<{ query: ListStaffQuery; returnType: PaginatedResponse<StaffMember> }> = {
  url: STAFF,
  methodType: MethodType.GET,
};

export const getStaffEndpoint: Endpoint<{ params: { id: string }; returnType: StaffMember }> = {
  url: `${STAFF}/:id`,
  methodType: MethodType.GET,
};

export const inviteStaffEndpoint: Endpoint<{ body: InviteStaffInput; returnType: StaffMember & { invitation: StaffInvitation } }> = {
  url: STAFF,
  methodType: MethodType.POST,
};

export const updateStaffEndpoint: Endpoint<{ params: { id: string }; body: UpdateStaffInput; returnType: StaffMember }> = {
  url: `${STAFF}/:id`,
  methodType: MethodType.PUT,
};

/** Re-mints the invitation of an account that has not activated; any earlier token stops working. */
export const resendStaffInviteEndpoint: Endpoint<{ params: { id: string }; returnType: StaffInvitation }> = {
  url: `${STAFF}/:id/invite`,
  methodType: MethodType.POST,
};
