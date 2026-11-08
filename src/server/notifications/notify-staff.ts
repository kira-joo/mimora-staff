import type mongoose from "mongoose";
import type { StaffNotificationType } from "../engines/notifications/staff-notification-policy";
import { staffNotificationRepository } from "../core/repositories";
import { STAFF_NOTIFICATION_RETENTION_MS } from "./staff-notification.schema";

export interface StaffNotificationInput {
  type: StaffNotificationType;
  title: string;
  body?: string;
  /** A console route, e.g. `/orders/<id>`. */
  link: string;
  entityType: "Order" | "Return" | "Variant";
  entityId: mongoose.Types.ObjectId;
}

/** Writes the notice NOW. Callers run it after their transaction commits (see `afterCommit` in ./after-commit), never inside it. */
export async function saveStaffNotification(input: StaffNotificationInput): Promise<void> {
  const at = new Date();
  await staffNotificationRepository.save({ ...input, readBy: [], at, expiresAt: new Date(at.getTime() + STAFF_NOTIFICATION_RETENTION_MS) });
}
