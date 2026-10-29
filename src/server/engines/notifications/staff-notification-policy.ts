import { AppPermission, CustomPermission } from "../../../common/authorization/authorization-registry";

/**
 * In-app notifications for staff: what exists, who may see each kind, and the
 * pure rules that decide whether one is raised.
 */
export const STAFF_NOTIFICATION_TYPES = ["NEW_ORDER", "PAYMENT_PROOF_SUBMITTED", "RETURN_REQUESTED", "LOW_STOCK"] as const;
export type StaffNotificationType = (typeof STAFF_NOTIFICATION_TYPES)[number];

/**
 * The permission that lets a staff member see each kind. `Notification.read`
 * opens the feed; THIS decides what is in it — a catalog editor with
 * `Notification.read` must not learn that a payment proof arrived, because the
 * feed would otherwise be a side door past `Payment.verify`.
 */
export const NOTIFICATION_TYPE_PERMISSION: Readonly<Record<StaffNotificationType, string>> = {
  NEW_ORDER: AppPermission.ORDER.READ,
  PAYMENT_PROOF_SUBMITTED: CustomPermission.PAYMENT_VERIFY,
  RETURN_REQUESTED: AppPermission.RETURN.READ,
  LOW_STOCK: AppPermission.VARIANT.READ,
};

/** The kinds a caller may see, given a way to ask "do I hold this permission". */
export function notificationTypesVisibleTo(can: (permission: string) => boolean): StaffNotificationType[] {
  return STAFF_NOTIFICATION_TYPES.filter((type) => can(NOTIFICATION_TYPE_PERMISSION[type]));
}

/** The staff notification a timeline event raises, or `null`. `ORDER_PLACED` is the new-order event. */
export function staffNotificationTypeForEvent(eventType: string): StaffNotificationType | null {
  switch (eventType) {
    case "ORDER_PLACED":
      return "NEW_ORDER";
    case "PAYMENT_SUBMITTED":
      return "PAYMENT_PROOF_SUBMITTED";
    case "RETURN_REQUESTED":
      return "RETURN_REQUESTED";
    default:
      return null;
  }
}

/**
 * A variant CROSSES its low-stock threshold when stock falls from above it to
 * at or below it — the one moment staff need telling. A variant already low
 * that sells another unit has not crossed anything, and notifying on every sale
 * would bury the one that matters. Matches `classifyStockHealth`: at or below
 * the threshold, or empty, is not healthy.
 */
export function crossedLowStockThreshold(before: number, after: number, threshold: number): boolean {
  const unhealthy = (stock: number) => stock <= 0 || stock <= threshold;
  return !unhealthy(before) && unhealthy(after);
}
