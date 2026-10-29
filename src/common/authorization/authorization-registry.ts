import { createAuthorizationRegistry } from "@kira-joo/backend-toolkit-core";
import type { PermissionDefinition } from "@kira-joo/backend-toolkit-core";
import { EntityName } from "./entity-name.enum";

/**
 * Generates one `read`/`readOne`/`create`/`update`/`delete` permission per
 * entity in {@link EntityName} — `AppPermission.PRODUCT.READ === "Product.read"`.
 * Consume `AppPermission`, never a hand-written permission string.
 */
export const authorization = createAuthorizationRegistry({ entities: EntityName });
export const AppPermission = authorization.permissions;

/**
 * Permissions that aren't CRUD on one entity — an order-status transition,
 * a payment decision, a catalog publish. Declared by hand because
 * `createAuthorizationRegistry()` only knows how to generate CRUD actions.
 *
 * **Phase 4A.5 — the two-tier vocabulary, populated now.** Modelled on
 * `restaurant-platform-staff`'s own two-tier design (generated CRUD +
 * literal action keys), not copied verbatim: every key here follows this
 * app's own `Entity.action` convention (matching what
 * `createAuthorizationRegistry` generates), not restaurant's
 * lowercase-dotted `"payment.verify"` — so `entityType` can always be read
 * directly off the permission key's first segment (`record-activity.ts`)
 * with no separate entity-name-resolution step.
 *
 * Riding these on a generic `Order.update`/`Product.update` would over-grant
 * — a catalog editor updating a product description must not thereby gain
 * the power to refund a payment. No route checks any of these yet (Phase
 * 4A.5 builds no routes); declared now so Phase 4B's route work has the
 * vocabulary ready rather than inventing it ad hoc per batch, and so
 * `syncPermissions()` at boot creates the `Permission` documents a future
 * role can be granted before any route depends on them existing.
 */
export const CustomPermission = {
  PAYMENT_VERIFY: "Payment.verify",
  PAYMENT_REJECT: "Payment.reject",
  PAYMENT_REFUND: "Payment.refund",
  ORDER_TRANSITION: "Order.transition",
  ORDER_CANCEL: "Order.cancel",
  CATALOG_PUBLISH: "Catalog.publish",
  /** Make the storefront-content draft live. Separate from editing it, so a merchandiser can prepare content an owner approves. */
  STOREFRONT_CONTENT_PUBLISH: "StorefrontContent.publish",
  STAFF_MANAGE: "StaffUser.manage",
  ROLE_MANAGE: "Role.manage",
  ACTIVITY_READ: "ActivityLog.read",
  /** The three MDS §15a reports. Read-only, separately grantable — sales figures are not implied by order access. */
  REPORT_READ: "Report.read",
  /*
   * Four keys added by the Phase 4B verification pass — found missing
   * against the canonical route inventory. `RETURN.APPROVE`/`RETURN.RECEIVE`
   * are the same sensitivity class as `PAYMENT.*` (a return decision
   * triggers restocking and refund eligibility); riding them on generic
   * `Return.update` would let any staff member with catalog-adjacent
   * update rights approve a refund-eligible return, which is exactly the
   * over-grant this whole vocabulary exists to prevent.
   */
  RETURN_APPROVE: "Return.approve",
  RETURN_RECEIVE: "Return.receive",
  INVENTORY_ADJUST: "Inventory.adjust",
  /** MDS §18: "a queue of pending/published/rejected... POST /permissions/sync" is explicitly superadmin-only. */
  PERMISSION_MANAGE: "Permission.manage",
  /** Opens the staff notification feed. WHICH notifications a holder sees is decided per kind by the permission that guards the underlying record (`engines/notifications/staff-notification-policy.ts`). */
  NOTIFICATION_READ: "Notification.read",
  /*
   * Customer privacy and recovery (legal-and-consent.md §5, task #70/#96/#89).
   * Each is its own key because none of them is implied by reading a customer:
   * exporting a person's data, destroying it, minting a credential for their
   * account, and downloading every customer in bulk are four different powers.
   */
  CUSTOMER_EXPORT_DATA: "Customer.exportData",
  CUSTOMER_REDACT: "Customer.redact",
  CUSTOMER_RESET_LINK: "Customer.createResetLink",
  /** CSV downloads — each held IN ADDITION to the matching read permission, so a download is never reachable by a role that cannot view the list. */
  CUSTOMER_EXPORT: "Customer.export",
  ORDER_EXPORT: "Order.export",
  INVENTORY_EXPORT: "Inventory.export",
} as const;

/**
 * Human-readable names for `CustomPermission`, in the same declaration
 * order — kept as a separate map (rather than inline on the const object)
 * so `CustomPermission`'s own values stay plain permission-key strings, the
 * shape every consumer actually wants to pass to `auth: {permissions}`.
 */
const CUSTOM_PERMISSION_NAMES: Record<string, string> = {
  [CustomPermission.PAYMENT_VERIFY]: "Verify Payment",
  [CustomPermission.PAYMENT_REJECT]: "Reject Payment",
  [CustomPermission.PAYMENT_REFUND]: "Refund Payment",
  [CustomPermission.ORDER_TRANSITION]: "Transition Order Status",
  [CustomPermission.ORDER_CANCEL]: "Cancel Order",
  [CustomPermission.CATALOG_PUBLISH]: "Publish Catalog",
  [CustomPermission.STOREFRONT_CONTENT_PUBLISH]: "Publish Storefront Content",
  [CustomPermission.STAFF_MANAGE]: "Manage Staff",
  [CustomPermission.ROLE_MANAGE]: "Manage Roles",
  [CustomPermission.ACTIVITY_READ]: "Read Activity Log",
  [CustomPermission.REPORT_READ]: "Read Reports",
  [CustomPermission.RETURN_APPROVE]: "Approve/Reject Return",
  [CustomPermission.RETURN_RECEIVE]: "Receive Return",
  [CustomPermission.INVENTORY_ADJUST]: "Adjust Inventory",
  [CustomPermission.PERMISSION_MANAGE]: "Manage Permissions",
  [CustomPermission.NOTIFICATION_READ]: "Read Notifications",
  [CustomPermission.CUSTOMER_EXPORT_DATA]: "Export a Customer's Data",
  [CustomPermission.CUSTOMER_REDACT]: "Redact (Delete) a Customer",
  [CustomPermission.CUSTOMER_RESET_LINK]: "Create Customer Password-Reset Link",
  [CustomPermission.CUSTOMER_EXPORT]: "Export Customers (CSV)",
  [CustomPermission.ORDER_EXPORT]: "Export Orders (CSV)",
  [CustomPermission.INVENTORY_EXPORT]: "Export Inventory (CSV)",
};

const CUSTOM_PERMISSION_DEFINITIONS: PermissionDefinition[] = Object.values(CustomPermission).map((key) => {
  const [entity] = key.split(".");
  return { entity: entity ?? key, action: key.split(".")[1] ?? key, key, name: CUSTOM_PERMISSION_NAMES[key] ?? key, isSystem: false };
});

export const ALL_PERMISSION_DEFINITIONS = [...authorization.definitions, ...CUSTOM_PERMISSION_DEFINITIONS];
