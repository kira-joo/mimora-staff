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
  /** Full access by flag, not by listing permissions — `permissions` is empty for such a role. */
  grantsAll: boolean;
  isActive: boolean;
  permissions: RolePermission[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ListRolesQuery {
  page?: number;
  limit?: number;
  [key: string]: unknown;
}

/** Read-only: the API has no create, edit or delete route for roles. */
export const listRolesEndpoint: Endpoint<{ query: ListRolesQuery; returnType: PaginatedResponse<Role> }> = {
  url: "/admin/roles",
  methodType: MethodType.GET,
};
