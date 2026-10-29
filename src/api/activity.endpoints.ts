import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";

/** One audit entry. `entityType`/`action` are the two halves of the route's permission key (`"Payment.verify"`). */
export interface ActivityEntry {
  _id: string;
  actor: { _id: string; name?: string; email?: string };
  action: string;
  entityType: string;
  entityId?: string;
  /** The request body as sent, sensitive keys redacted by the API. Absent for a body-less action. */
  changes?: Record<string, unknown>;
  ipAddress?: string;
  at: string;
}

export interface ListActivityQuery {
  page?: number;
  limit?: number;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: string;
  to?: string;
  [key: string]: unknown;
}

export const listActivityEndpoint: Endpoint<{ query: ListActivityQuery; returnType: PaginatedResponse<ActivityEntry> }> = {
  url: "/admin/activity",
  methodType: MethodType.GET,
};
