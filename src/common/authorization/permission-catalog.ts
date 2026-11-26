import { ALL_PERMISSION_DEFINITIONS } from "./authorization-registry";

/**
 * Which permissions a role can be given, and how the console's permission matrix lays them out.
 *
 * The registry generates `read`/`readOne`/`create`/`update`/`delete` for every entity, but many of those guard nothing
 * (no route creates an Order from the console, nothing edits a Wishlist). Offering a checkbox that changes nothing
 * misleads whoever ticks it, so the matrix shows only keys some `/api/admin/**` route enforces. This list is the
 * complement — and `permission-catalog.test.ts` recomputes it from the route files, so a new route that starts
 * enforcing one of these (or a route that stops) fails the build until this list agrees.
 *
 * Nothing here deletes a stored permission: a role holding one of these keeps it, it simply isn't offered.
 */
export const UNENFORCED_PERMISSION_KEYS: ReadonlySet<string> = new Set([
  "StockMovement.readOne",
  "StockMovement.create",
  "StockMovement.update",
  "StockMovement.delete",
  "CatalogImportBatch.update",
  "Order.create",
  "Order.update",
  "Order.delete",
  "Order.cancel",
  "PaymentProof.read",
  "PaymentProof.readOne",
  "PaymentProof.create",
  "PaymentProof.update",
  "PaymentProof.delete",
  "Return.create",
  "Return.update",
  "Return.delete",
  "Review.readOne",
  "Review.create",
  "Review.delete",
  "Wishlist.read",
  "Wishlist.readOne",
  "Wishlist.create",
  "Wishlist.update",
  "Wishlist.delete",
  "StoreProfile.readOne",
  "StoreProfile.create",
  "StoreProfile.delete",
  "StorefrontContent.readOne",
  "StorefrontContent.create",
  "StorefrontContent.delete",
  "FulfilmentSettings.readOne",
  "FulfilmentSettings.create",
  "FulfilmentSettings.delete",
  "PaymentSettings.readOne",
  "PaymentSettings.create",
  "PaymentSettings.delete",
  "InventorySettings.readOne",
  "InventorySettings.create",
  "InventorySettings.delete",
  "NotificationSettings.readOne",
  "NotificationSettings.create",
  "NotificationSettings.delete",
  "OperatingHours.readOne",
  "OperatingHours.create",
  "OperatingHours.delete",
  "StaffUser.delete",
  "Customer.create",
  "Customer.update",
  "Customer.delete",
  "NewsletterSubscriber.readOne",
  "NewsletterSubscriber.create",
  "NewsletterSubscriber.delete",
  "Address.read",
  "Address.readOne",
  "Address.create",
  "Address.update",
  "Address.delete",
  "Role.readOne",
  "Role.manage",
]);

/** Every key a role may be given: defined in code, and enforced by at least one admin route. */
export const ASSIGNABLE_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  ALL_PERMISSION_DEFINITIONS.map((definition) => definition.key).filter((key) => !UNENFORCED_PERMISSION_KEYS.has(key))
);

/** The matrix's column for a generated CRUD action. Anything else is a "special" action shown beside them. */
export type MatrixColumn = "view" | "create" | "update" | "delete";

export const MATRIX_COLUMN_ACTIONS: Record<MatrixColumn, readonly string[]> = {
  view: ["read", "readOne"],
  create: ["create"],
  update: ["update"],
  delete: ["delete"],
};

export interface PermissionModule {
  entity: string;
  label: string;
}

export interface PermissionSection {
  label: string;
  modules: PermissionModule[];
}

/**
 * The matrix rows, in the console navigation's order and words. An entity with assignable permissions that is not
 * listed here still appears, under "Other" — never silently dropped.
 */
export const PERMISSION_SECTIONS: PermissionSection[] = [
  {
    label: "Operations",
    modules: [
      { entity: "Order", label: "Orders" },
      { entity: "Payment", label: "Payments" },
      { entity: "Return", label: "Returns" },
      { entity: "Variant", label: "Variants & stock" },
      { entity: "Inventory", label: "Inventory" },
      { entity: "StockMovement", label: "Stock adjustments log" },
    ],
  },
  {
    label: "Catalog",
    modules: [
      { entity: "Product", label: "Products" },
      { entity: "ProductGroup", label: "Product groups" },
      { entity: "Category", label: "Categories" },
      { entity: "Collection", label: "Collections" },
      { entity: "Brand", label: "Brands" },
      { entity: "SizeGuide", label: "Size guides" },
      { entity: "CatalogImportBatch", label: "Bulk import" },
      { entity: "Catalog", label: "Catalog publishing" },
    ],
  },
  {
    label: "Customers",
    modules: [
      { entity: "Customer", label: "Customers" },
      { entity: "Review", label: "Reviews" },
    ],
  },
  {
    label: "Marketing & content",
    modules: [
      { entity: "NewsletterSubscriber", label: "Newsletter" },
      { entity: "Promotion", label: "Promotions" },
      { entity: "Page", label: "Pages" },
      { entity: "StorefrontContent", label: "Storefront content" },
    ],
  },
  {
    label: "Fulfilment",
    modules: [
      { entity: "DeliveryZone", label: "Delivery zones" },
      { entity: "PickupLocation", label: "Pickup locations" },
      { entity: "OperatingHours", label: "Opening hours" },
      { entity: "FulfilmentSettings", label: "Fulfilment settings" },
    ],
  },
  {
    label: "Insights",
    modules: [
      { entity: "Report", label: "Reports" },
      { entity: "ActivityLog", label: "Activity log" },
      { entity: "Notification", label: "Staff notifications" },
    ],
  },
  {
    label: "Team & access",
    modules: [
      { entity: "StaffUser", label: "Users" },
      { entity: "Role", label: "Roles" },
      { entity: "Permission", label: "Permission registry" },
    ],
  },
  {
    label: "Settings",
    modules: [
      { entity: "StoreProfile", label: "Store profile & theme" },
      { entity: "PaymentSettings", label: "Payment methods" },
      { entity: "InventorySettings", label: "Inventory settings" },
      { entity: "NotificationSettings", label: "Customer notifications" },
    ],
  },
];
