import { Boxes, CreditCard, PackageOpen, ShoppingBag, type LucideIcon } from "lucide-react";
import type { StaffNotificationType } from "src/api/notifications.endpoints";

/** Each kind's icon and plain-language label — icon and text always travel together, colour carries nothing. */
export const NOTIFICATION_KIND: Record<StaffNotificationType, { label: string; icon: LucideIcon }> = {
  NEW_ORDER: { label: "New order", icon: ShoppingBag },
  PAYMENT_PROOF_SUBMITTED: { label: "Payment proof", icon: CreditCard },
  RETURN_REQUESTED: { label: "Return requested", icon: PackageOpen },
  LOW_STOCK: { label: "Stock", icon: Boxes },
};

/** The bell's badge text: nothing at zero, and a cap so a backlog never widens the header. */
export function unreadBadge(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? "99+" : String(unread);
}

/** Spoken label for the bell: the count is in the name, so the badge is not the only carrier. */
export function bellLabel(unread: number): string {
  return unread <= 0 ? "Notifications, none unread" : `Notifications, ${unread > 99 ? "more than 99" : unread} unread`;
}
