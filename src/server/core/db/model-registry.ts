import type { Model } from "mongoose";
import { StaffRefreshTokenModel } from "../../identity/staff-refresh-token.schema";
import { CustomerRefreshTokenModel } from "../../identity/customer-refresh-token.schema";
import { CustomerModel } from "../../identity/customer.schema";
import { ConsentEventModel } from "../../identity/consent-event.schema";
import { NewsletterSubscriberModel } from "../../newsletter/newsletter-subscriber.schema";
import { StaffUserModel } from "../../identity/staff-user.schema";
import { PendingUploadModel } from "../../catalog/pending-upload.schema";
import { StaffOwnerLockModel } from "../../identity/staff-owner-lock.schema";
import { CategoryModel } from "../../catalog/category.schema";
import { CollectionModel } from "../../catalog/collection.schema";
import { BrandModel } from "../../catalog/brand.schema";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { SizeGuideModel } from "../../catalog/size-guide.schema";
import { StockMovementModel } from "../../catalog/stock-movement.schema";
import { CatalogImportBatchModel } from "../../catalog/catalog-import-batch.schema";
import { CartModel } from "../../commerce/cart.schema";
import { CartLineModel } from "../../commerce/cart-line.schema";
import { OrderModel, OrderLineModel } from "../../commerce/order.schema";
import { OrderSequenceModel } from "../../commerce/order-sequence.schema";
import { InvoiceSequenceModel } from "../../invoices/invoice-sequence.schema";
import { PaymentProofModel } from "../../commerce/payment-proof.schema";
import { ReturnModel, ReturnLineModel } from "../../commerce/return.schema";
import { ReturnSequenceModel } from "../../commerce/return-sequence.schema";
import { PromotionModel } from "../../commerce/promotion.schema";
import { IdempotencyRecordModel } from "../../commerce/idempotency-record.schema";
import { WishlistModel } from "../../commerce/wishlist.schema";
import { PageModel } from "../../content/page.schema";
import { PageRevisionModel } from "../../content/page-revision.schema";
import { ReviewModel } from "../../content/review.schema";
import { StoreProfileModel } from "../../content/store-profile.schema";
import { StorefrontContentModel } from "../../content/storefront-content.schema";
import { DeliveryZoneModel } from "../../fulfilment/delivery-zone.schema";
import { FulfilmentSettingsModel } from "../../fulfilment/fulfilment-settings.schema";
import { InventorySettingsModel } from "../../fulfilment/inventory-settings.schema";
import { NotificationSettingsModel } from "../../fulfilment/notification-settings.schema";
import { OperatingHoursModel } from "../../fulfilment/operating-hours.schema";
import { PaymentSettingsModel } from "../../fulfilment/payment-settings.schema";
import { PickupLocationModel } from "../../fulfilment/pickup-location.schema";
import { AddressModel } from "../address.schema";
import { ActivityLogModel } from "../activity-log.schema";
import { PermissionModel, RoleModel } from "../authorization/role.model";
import { RateLimitModel } from "../rate-limit/rate-limit.schema";
import { StaffNotificationModel } from "../../notifications/staff-notification.schema";

/**
 * Exhaustive registry of all Mongoose models.
 *
 * Used by ensureIndexes() to validate uniqueness constraints at boot.
 * Every model MUST be listed here.
 */
export const ALL_MODELS = [
  // Identity
  StaffRefreshTokenModel,
  CustomerRefreshTokenModel,
  CustomerModel,
  ConsentEventModel,
  StaffUserModel,
  StaffOwnerLockModel,

  // Catalog
  PendingUploadModel,
  CategoryModel,
  CollectionModel,
  BrandModel,
  ProductModel,
  VariantModel,
  SizeGuideModel,
  StockMovementModel,
  CatalogImportBatchModel,

  // Commerce
  CartModel,
  CartLineModel,
  OrderModel,
  OrderLineModel,
  OrderSequenceModel,
  InvoiceSequenceModel,
  PaymentProofModel,
  ReturnModel,
  ReturnLineModel,
  ReturnSequenceModel,
  PromotionModel,
  IdempotencyRecordModel,
  WishlistModel,

  // Marketing
  NewsletterSubscriberModel,

  // Content
  PageModel,
  PageRevisionModel,
  ReviewModel,
  StoreProfileModel,
  StorefrontContentModel,

  // Fulfilment
  DeliveryZoneModel,
  FulfilmentSettingsModel,
  InventorySettingsModel,
  NotificationSettingsModel,
  OperatingHoursModel,
  PaymentSettingsModel,
  PickupLocationModel,

  // Core
  AddressModel,
  ActivityLogModel,
  RateLimitModel,
  StaffNotificationModel,

  // Authorization
  PermissionModel,
  RoleModel,
] as unknown as Model<never>[];
