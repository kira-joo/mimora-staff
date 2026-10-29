import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";

/** Roles are few and predefined (v1 — no custom RBAC), so this exists only for the `page`/`limit` shape every list endpoint shares. */
export class ListAdminRolesQueryDto extends BaseFindQueryDto {}
