import { ALL_PERMISSION_DEFINITIONS } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";

interface RecordLink {
  route: (id: string) => string;
  /** What the link opens, for its label. */
  noun: string;
}

/**
 * Where an entry's record opens. `entityId` is the route's `:id`. Payment
 * decisions are logged under "Payment" and live on orders, so their id is
 * the order's; a return refund — guarded by the same `Payment.refund`
 * permission — is logged as `Return.refund` on its return. Entities with no
 * screen of their own (a variant, a settings singleton) have no link.
 *
 * Entries written before return refunds were logged as `Return.refund`
 * (pre-launch QA data only) carry a return id under `Payment.refund`.
 */
const RECORD_LINK: Partial<Record<string, RecordLink>> = {
  Order: { route: AppRoute.ORDER, noun: "order" },
  Return: { route: AppRoute.RETURN, noun: "return" },
  Product: { route: AppRoute.PRODUCT, noun: "product" },
  Category: { route: AppRoute.CATEGORY, noun: "category" },
  Collection: { route: AppRoute.COLLECTION, noun: "collection" },
  Brand: { route: AppRoute.BRAND, noun: "brand" },
  SizeGuide: { route: AppRoute.SIZE_GUIDE, noun: "size guide" },
  Promotion: { route: AppRoute.PROMOTION, noun: "promotion" },
  Page: { route: AppRoute.PAGE, noun: "page" },
  DeliveryZone: { route: AppRoute.DELIVERY_ZONE, noun: "delivery zone" },
  PickupLocation: { route: AppRoute.PICKUP_LOCATION, noun: "pickup location" },
  StaffUser: { route: AppRoute.TEAM_MEMBER, noun: "staff member" },
  Customer: { route: AppRoute.CUSTOMER, noun: "customer" },
};

export function recordLink(entityType: string, entityId?: string): { href: string; noun: string } | undefined {
  if (!entityId) return undefined;
  if (entityType === "Payment") return { href: AppRoute.ORDER(entityId), noun: "order" };
  const link = RECORD_LINK[entityType];
  return link ? { href: link.route(entityId), noun: link.noun } : undefined;
}

/** "DeliveryZone" → "Delivery zone", "StaffUser" → "Staff user". */
export function humanize(identifier: string): string {
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Filter options from the permission registry — the same vocabulary the log's `entityType`/`action` are written in. */
export const ENTITY_OPTIONS = [...new Set(ALL_PERMISSION_DEFINITIONS.map((definition) => definition.key.split(".")[0]!))]
  .sort()
  .map((entity) => ({ value: entity, label: humanize(entity) }));

export const ACTION_OPTIONS = [...new Set(ALL_PERMISSION_DEFINITIONS.map((definition) => definition.key.split(".").slice(1).join(".")))]
  .filter((action) => action && !action.startsWith("read"))
  .sort()
  .map((action) => ({ value: action, label: humanize(action) }));

export interface ChangeLine {
  path: string;
  value: string;
}

const MAX_DEPTH = 3;

/**
 * The recorded body as readable lines: nested objects become dotted paths
 * (`contact.phone`), arrays of scalars join, anything deeper is shown as JSON.
 * Values are shown as sent — including the API's "[redacted]".
 */
export function changeLines(changes: Record<string, unknown> | undefined, prefix = "", depth = 0): ChangeLine[] {
  if (!changes) return [];
  return Object.entries(changes).flatMap(([key, value]): ChangeLine[] => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) return [{ path, value: "—" }];
    if (Array.isArray(value)) {
      const scalar = value.every((entry) => entry === null || typeof entry !== "object");
      return [{ path, value: value.length === 0 ? "(none)" : scalar ? value.join(", ") : JSON.stringify(value) }];
    }
    if (typeof value === "object") {
      return depth + 1 >= MAX_DEPTH ? [{ path, value: JSON.stringify(value) }] : changeLines(value as Record<string, unknown>, path, depth + 1);
    }
    return [{ path, value: String(value) }];
  });
}
