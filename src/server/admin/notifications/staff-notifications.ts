import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { hasPermission } from "@kira-joo/frontend-toolkit-core/server";
import { SortOrder, type PaginatedResponse } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { notificationTypesVisibleTo, type StaffNotificationType } from "../../engines/notifications/staff-notification-policy";
import { staffNotificationRepository } from "../../core/repositories";
import { StaffNotificationModel } from "../../notifications/staff-notification.schema";
import type { ListNotificationsQueryDto } from "../dto/list-notifications-query.dto";

/** The caller, as the route factory resolves them. */
export type NotificationReader = Parameters<typeof hasPermission>[0] & { _id: unknown };

export interface StaffNotificationView {
  _id: string;
  type: StaffNotificationType;
  title: string;
  body?: string;
  link: string;
  entityType: string;
  entityId: string;
  at: Date;
  read: boolean;
}

const readerId = (reader: NotificationReader) => new mongoose.Types.ObjectId(String(reader._id));

/**
 * The kinds this caller may see. `Notification.read` opens the feed, but each
 * kind is also guarded by the permission on the record it announces — so the
 * feed is never a way round `Payment.verify` or `Order.read`. A caller who may
 * see no kind at all sees an empty feed, not an error.
 */
function visibleTypes(reader: NotificationReader): StaffNotificationType[] {
  return notificationTypesVisibleTo((permission) => hasPermission(reader, permission));
}

export async function listStaffNotifications(reader: NotificationReader, query: ListNotificationsQueryDto): Promise<PaginatedResponse<StaffNotificationView>> {
  const me = readerId(reader);
  const { unread, ...rest } = query;
  const where: Record<string, unknown> = { type: { $in: visibleTypes(reader) } };
  if (unread === "true") where.readBy = { $ne: me };

  const page = await staffNotificationRepository.findAllAndCountPublic({ where, sort: { field: "at", order: SortOrder.DESC }, query: rest });
  return {
    ...page,
    data: page.data.map((n) => ({
      _id: n._id.toString(),
      type: n.type,
      title: n.title,
      ...(n.body ? { body: n.body } : {}),
      link: n.link,
      entityType: n.entityType,
      entityId: n.entityId.toString(),
      at: n.at,
      read: (n.readBy ?? []).some((id) => id.toString() === me.toString()),
    })),
  };
}

export async function countUnreadStaffNotifications(reader: NotificationReader): Promise<number> {
  return staffNotificationRepository.count({ where: { type: { $in: visibleTypes(reader) }, readBy: { $ne: readerId(reader) } } });
}

/** Marks one notification read for the caller only. One the caller may not see is "not found", never "forbidden" — its existence is not theirs to learn. */
export async function markStaffNotificationRead(reader: NotificationReader, id: string): Promise<{ read: true }> {
  const result = await StaffNotificationModel.updateOne({ _id: id, type: { $in: visibleTypes(reader) } }, { $addToSet: { readBy: readerId(reader) } });
  if (result.matchedCount === 0) throw new NotFoundError("Notification was not found");
  return { read: true };
}

/** Marks everything the caller may see as read — for the caller only. */
export async function markAllStaffNotificationsRead(reader: NotificationReader): Promise<{ marked: number }> {
  const me = readerId(reader);
  // `updateMany`: the repository has no multi-document update, and this is exactly the case its own docs name for a direct Model call.
  const result = await StaffNotificationModel.updateMany({ type: { $in: visibleTypes(reader) }, readBy: { $ne: me } }, { $addToSet: { readBy: me } });
  return { marked: result.modifiedCount };
}
