/**
 * Every entity `createAuthorizationRegistry()` generates CRUD permissions
 * for. One key per real Mongoose model — adding an entity here and
 * re-running `reconcilePermissions()` (at boot, `src/instrumentation.ts`) is the
 * whole mechanism for extending admin permission coverage as later Phase 4
 * work adds routes for it.
 */
export const EntityName = {
  PRODUCT: "Product",
  VARIANT: "Variant",
  CATEGORY: "Category",
  COLLECTION: "Collection",
  PRODUCT_GROUP: "ProductGroup",
  BRAND: "Brand",
  SIZE_GUIDE: "SizeGuide",
  STOCK_MOVEMENT: "StockMovement",
  CATALOG_IMPORT_BATCH: "CatalogImportBatch",
  ORDER: "Order",
  PAYMENT_PROOF: "PaymentProof",
  RETURN: "Return",
  PROMOTION: "Promotion",
  REVIEW: "Review",
  WISHLIST: "Wishlist",
  PAGE: "Page",
  STORE_PROFILE: "StoreProfile",
  STOREFRONT_CONTENT: "StorefrontContent",
  DELIVERY_ZONE: "DeliveryZone",
  FULFILMENT_SETTINGS: "FulfilmentSettings",
  PAYMENT_SETTINGS: "PaymentSettings",
  INVENTORY_SETTINGS: "InventorySettings",
  NOTIFICATION_SETTINGS: "NotificationSettings",
  OPERATING_HOURS: "OperatingHours",
  PICKUP_LOCATION: "PickupLocation",
  STAFF_USER: "StaffUser",
  CUSTOMER: "Customer",
  NEWSLETTER_SUBSCRIBER: "NewsletterSubscriber",
  ADDRESS: "Address",
  ROLE: "Role",
} as const;
