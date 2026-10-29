import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";

/** One in-app notice, as GET /admin/notifications answers it (wire types). `read` is the signed-in staff member's own state. */
export type StaffNotificationType = "NEW_ORDER" | "PAYMENT_PROOF_SUBMITTED" | "RETURN_REQUESTED" | "LOW_STOCK";

export interface StaffNotification {
  _id: string;
  type: StaffNotificationType;
  title: string;
  body?: string;
  /** A console route. */
  link: string;
  entityType: string;
  entityId: string;
  at: string;
  read: boolean;
}

export interface ListNotificationsQuery {
  page?: number;
  limit?: number;
  unread?: "true" | "false";
  [key: string]: unknown;
}

const NOTIFICATIONS = "/admin/notifications";

export const listNotificationsEndpoint: Endpoint<{ query: ListNotificationsQuery; returnType: PaginatedResponse<StaffNotification> }> = {
  url: NOTIFICATIONS,
  methodType: MethodType.GET,
};

export const unreadNotificationCountEndpoint: Endpoint<{ returnType: { unread: number } }> = {
  url: `${NOTIFICATIONS}/unread-count`,
  methodType: MethodType.GET,
};

export const markNotificationReadEndpoint: Endpoint<{ params: { id: string }; returnType: { read: true } }> = {
  url: `${NOTIFICATIONS}/:id/read`,
  methodType: MethodType.PUT,
};

export const markAllNotificationsReadEndpoint: Endpoint<{ returnType: { marked: number } }> = {
  url: `${NOTIFICATIONS}/read-all`,
  methodType: MethodType.PUT,
};
