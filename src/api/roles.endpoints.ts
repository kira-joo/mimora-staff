import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";

/** One permission as /api/admin/roles populates it (`Entity.action` key plus a human name). */
export interface RolePermission {
  _id: string;
  key: string;
  entity: string;
  action: string;
  name: string;
  isActive: boolean;
  isSystem: boolean;
}

export interface Role {
  _id: string;
  name: string;
  /** Full access by flag, not by listing permissions — `permissions` is usually empty for such a role. */
  grantsAll: boolean;
  isActive: boolean;
  permissions: RolePermission[];
  /** Team members holding this role, and how many of them are active. */
  memberCount: number;
  activeMemberCount: number;
  /** The default Owner role: always full access; can't be renamed or deleted. */
  isOwnerRole: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ListRolesQuery {
  page?: number;
  limit?: number;
  [key: string]: unknown;
}

/** A permission a role can be given. */
export type AssignablePermission = Omit<RolePermission, "isActive">;

export interface RoleInput {
  name: string;
  permissionKeys: string[];
  grantsAll?: boolean;
  isActive?: boolean;
}

const ROLES = "/admin/roles";

/** Every role (they are few), Owner first, with member counts. */
export const listRolesEndpoint: Endpoint<{ query: ListRolesQuery; returnType: PaginatedResponse<Role> }> = {
  url: ROLES,
  methodType: MethodType.GET,
};

export const getRoleEndpoint: Endpoint<{ params: { id: string }; returnType: Role }> = {
  url: `${ROLES}/:id`,
  methodType: MethodType.GET,
};

export const createRoleEndpoint: Endpoint<{ body: RoleInput; returnType: Role }> = {
  url: ROLES,
  methodType: MethodType.POST,
};

/** Send only what changed. */
export const updateRoleEndpoint: Endpoint<{ params: { id: string }; body: Partial<RoleInput>; returnType: Role }> = {
  url: `${ROLES}/:id`,
  methodType: MethodType.PUT,
};

/** Only a role nobody holds; never the Owner role. */
export const deleteRoleEndpoint: Endpoint<{ params: { id: string }; returnType: Role }> = {
  url: `${ROLES}/:id`,
  methodType: MethodType.DELETE,
};

/** The permissions a role can be given — the permission matrix's rows and columns. */
export const listPermissionsEndpoint: Endpoint<{ returnType: PaginatedResponse<AssignablePermission> }> = {
  url: "/admin/permissions",
  methodType: MethodType.GET,
};
