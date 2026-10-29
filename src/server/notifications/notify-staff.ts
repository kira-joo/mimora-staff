import type mongoose from "mongoose";
import type { StaffNotificationType } from "../engines/notifications/staff-notification-policy";
import { staffNotificationRepository } from "../core/repositories";
import { STAFF_NOTIFICATION_RETENTION_MS } from "./staff-notification.schema";
import { afterCommit } from "./after-commit";

export interface StaffNotificationInput {
  type: StaffNotificationType;
  title: string;
  body?: string;
  /** A console route, e.g. `/orders/<id>`. */
  link: string;
  entityType: "Order" | "Return" | "Variant";
  entityId: mongoose.Types.ObjectId;
}

/** Writes the notice NOW. For code that is already running after commit; everyone else calls {@link raiseStaffNotification}. */
export async function saveStaffNotification(input: StaffNotificationInput): Promise<void> {
  const at = new Date();
  await staffNotificationRepository.save({ ...input, readBy: [], at, expiresAt: new Date(at.getTime() + STAFF_NOTIFICATION_RETENTION_MS) });
}

/**
 * Raises an in-app notice for staff — after the surrounding transaction
 * commits, never inside it, and never failing the operation it reports on
 * (`afterCommit`). A rolled-back order therefore leaves no "new order" behind.
 */
export async function raiseStaffNotification(input: StaffNotificationInput): Promise<void> {
  await afterCommit(`staff notification ${input.type}`, () => saveStaffNotification(input));
}
