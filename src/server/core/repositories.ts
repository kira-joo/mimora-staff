import { createMongooseRepository, createPermissionRepository, createRoleRepository } from "@kira-joo/backend-toolkit-mongoose";
import { PermissionModel, RoleModel } from "./authorization/role.model";
import { AddressModel } from "./address.schema";
import { CustomerModel } from "../identity/customer.schema";
import { ConsentEventModel } from "../identity/consent-event.schema";
import { NewsletterSubscriberModel } from "../newsletter/newsletter-subscriber.schema";
import { BrandModel } from "../catalog/brand.schema";
import { CatalogImportBatchModel } from "../catalog/catalog-import-batch.schema";
import { CategoryModel } from "../catalog/category.schema";
import { CollectionModel } from "../catalog/collection.schema";
import { ProductModel } from "../catalog/product.schema";
import { SizeGuideModel } from "../catalog/size-guide.schema";
import { VariantModel } from "../catalog/variant.schema";
import { CartModel } from "../commerce/cart.schema";
import { CartLineModel } from "../commerce/cart-line.schema";
import { OrderModel } from "../commerce/order.schema";
import { OrderLineModel } from "../commerce/order.schema";
import { PromotionModel } from "../commerce/promotion.schema";
import { PaymentProofModel } from "../commerce/payment-proof.schema";
import { ReturnModel, ReturnLineModel } from "../commerce/return.schema";
import { PageModel } from "../content/page.schema";
import { PageRevisionModel } from "../content/page-revision.schema";
import { ReviewModel } from "../content/review.schema";
import { DeliveryZoneModel } from "../fulfilment/delivery-zone.schema";
import { PickupLocationModel } from "../fulfilment/pickup-location.schema";
import { StaffUserModel } from "../identity/staff-user.schema";
import { PendingUploadModel } from "../catalog/pending-upload.schema";
import { StaffOwnerLockModel } from "../identity/staff-owner-lock.schema";
import { ActivityLogModel } from "./activity-log.schema";
import { StoreProfileModel } from "../content/store-profile.schema";
import { StorefrontContentModel } from "../content/storefront-content.schema";
import { FulfilmentSettingsModel } from "../fulfilment/fulfilment-settings.schema";
import { PaymentSettingsModel } from "../fulfilment/payment-settings.schema";
import { NotificationSettingsModel } from "../fulfilment/notification-settings.schema";
import { OperatingHoursModel } from "../fulfilment/operating-hours.schema";
import { InventorySettingsModel } from "../fulfilment/inventory-settings.schema";
import { WishlistModel } from "../commerce/wishlist.schema";
import { IdempotencyRecordModel } from "../commerce/idempotency-record.schema";
import { OrderSequenceModel } from "../commerce/order-sequence.schema";
import { InvoiceSequenceModel } from "../invoices/invoice-sequence.schema";
import { ReturnSequenceModel } from "../commerce/return-sequence.schema";
import { StockMovementModel } from "../catalog/stock-movement.schema";
import { RateLimitModel } from "./rate-limit/rate-limit.schema";
import { StaffNotificationModel } from "../notifications/staff-notification.schema";
import type { AddressSchema } from "./address.schema";
import type { WishlistSchema } from "../commerce/wishlist.schema";
import type { IdempotencyRecordSchema } from "../commerce/idempotency-record.schema";
import type { PendingUploadSchema } from "../catalog/pending-upload.schema";
import type { StaffOwnerLockSchema } from "../identity/staff-owner-lock.schema";
import type { OrderSequenceSchema } from "../commerce/order-sequence.schema";
import type { InvoiceSequenceSchema } from "../invoices/invoice-sequence.schema";
import type { ReturnSequenceSchema } from "../commerce/return-sequence.schema";
import type { StockMovementSchema } from "../catalog/stock-movement.schema";
import type { RateLimitSchema } from "./rate-limit/rate-limit.schema";
import type { StaffNotificationSchema } from "../notifications/staff-notification.schema";
import type { CustomerSchema } from "../identity/customer.schema";
import type { ConsentEventSchema } from "../identity/consent-event.schema";
import type { NewsletterSubscriberSchema } from "../newsletter/newsletter-subscriber.schema";
import type { BrandSchema } from "../catalog/brand.schema";
import type { CatalogImportBatchSchema } from "../catalog/catalog-import-batch.schema";
import type { CategorySchema } from "../catalog/category.schema";
import type { CollectionSchema } from "../catalog/collection.schema";
import type { ProductSchema } from "../catalog/product.schema";
import type { SizeGuideSchema } from "../catalog/size-guide.schema";
import type { VariantSchema } from "../catalog/variant.schema";
import type { CartSchema } from "../commerce/cart.schema";
import type { CartLineSchema } from "../commerce/cart-line.schema";
import type { OrderSchema, OrderLineSchema } from "../commerce/order.schema";
import type { PromotionSchema } from "../commerce/promotion.schema";
import type { PaymentProofSchema } from "../commerce/payment-proof.schema";
import type { ReturnSchema, ReturnLineSchema } from "../commerce/return.schema";
import type { PageSchema } from "../content/page.schema";
import type { PageRevisionSchema } from "../content/page-revision.schema";
import type { ReviewSchema } from "../content/review.schema";
import type { DeliveryZoneSchema } from "../fulfilment/delivery-zone.schema";
import type { PickupLocationSchema } from "../fulfilment/pickup-location.schema";
import type { StaffUserSchema } from "../identity/staff-user.schema";
import type { ActivityLogSchema } from "./activity-log.schema";
import type { StoreProfileSchema } from "../content/store-profile.schema";
import type { StorefrontContentSchema } from "../content/storefront-content.schema";
import type { FulfilmentSettingsSchema } from "../fulfilment/fulfilment-settings.schema";
import type { PaymentSettingsSchema } from "../fulfilment/payment-settings.schema";
import type { NotificationSettingsSchema } from "../fulfilment/notification-settings.schema";
import type { OperatingHoursSchema } from "../fulfilment/operating-hours.schema";
import type { InventorySettingsSchema } from "../fulfilment/inventory-settings.schema";

/**
 * One repository per entity a route actually needs, added as routes are
 * built — not a repository per Phase-2 model speculatively. `DTO →
 * validation → logic → repository` (Phase 4 spec) is the flow every route
 * follows; a repository with no route calling it is dead weight the same
 * way an engine with no caller would be.
 *
 * Every read and write of an entity listed here goes through its
 * repository, not its Model. The repository supplies what a raw Model call
 * silently skips: soft-delete filtering, `NotFoundError` by default,
 * duplicate-key translation, sanitized lean reads, and the ambient
 * `withTransaction` session (no `session` argument is ever needed).
 *
 * A direct Model call is correct only for an operation the repository
 * cannot express — `bulkWrite`, `aggregate`, or a toolkit API that takes a
 * Model by design (`syncPermissions`).
 */
export const staffUserRepository = createMongooseRepository<StaffUserSchema>({
  model: StaffUserModel,
  entityName: "StaffUser",
});

/**
 * `RoleSchema`/`PermissionSchema` never vary across applications
 * (`@kira-joo/backend-toolkit-mongoose` owns their shape entirely), so
 * these use the toolkit's own dedicated repository factories rather than
 * the generic `createMongooseRepository<T>()` every application-owned
 * entity above uses.
 */
export const roleRepository = createRoleRepository({ model: RoleModel });
export const permissionRepository = createPermissionRepository({ model: PermissionModel });

export const customerRepository = createMongooseRepository<CustomerSchema>({
  model: CustomerModel,
  entityName: "Customer",
});

/** Append-only record of every marketing-consent change — see `identity/consent-event.schema.ts`. */
export const consentEventRepository = createMongooseRepository<ConsentEventSchema>({
  model: ConsentEventModel,
  entityName: "ConsentEvent",
});

/** Newsletter capture and its suppression list — see `newsletter/newsletter-subscriber.schema.ts`. */
export const newsletterSubscriberRepository = createMongooseRepository<NewsletterSubscriberSchema>({
  model: NewsletterSubscriberModel,
  entityName: "NewsletterSubscriber",
});

export const addressRepository = createMongooseRepository<AddressSchema>({
  model: AddressModel,
  entityName: "Address",
});

export const productRepository = createMongooseRepository<ProductSchema>({
  model: ProductModel,
  entityName: "Product",
});

export const categoryRepository = createMongooseRepository<CategorySchema>({
  model: CategoryModel,
  entityName: "Category",
});

export const collectionRepository = createMongooseRepository<CollectionSchema>({
  model: CollectionModel,
  entityName: "Collection",
});

export const brandRepository = createMongooseRepository<BrandSchema>({
  model: BrandModel,
  entityName: "Brand",
});

export const variantRepository = createMongooseRepository<VariantSchema>({
  model: VariantModel,
  entityName: "Variant",
});

export const sizeGuideRepository = createMongooseRepository<SizeGuideSchema>({
  model: SizeGuideModel,
  entityName: "SizeGuide",
});

export const catalogImportBatchRepository = createMongooseRepository<CatalogImportBatchSchema>({
  model: CatalogImportBatchModel,
  entityName: "CatalogImportBatch",
});

export const reviewRepository = createMongooseRepository<ReviewSchema>({
  model: ReviewModel,
  entityName: "Review",
});

export const promotionRepository = createMongooseRepository<PromotionSchema>({
  model: PromotionModel,
  entityName: "Promotion",
});

export const pageRepository = createMongooseRepository<PageSchema>({
  model: PageModel,
  entityName: "Page",
});

/** Append-only — written beside `pageRepository` in one transaction, never updated. */
export const pageRevisionRepository = createMongooseRepository<PageRevisionSchema>({
  model: PageRevisionModel,
  entityName: "PageRevision",
});

/**
 * `DeliveryZone` opted into soft delete (`@MongoSchema({softDelete: true})`)
 * — that filtering happens only in the repository's own read methods, not
 * as a Mongoose query plugin on the raw model. A raw `DeliveryZoneModel.find()`
 * would silently include soft-deleted zones; the repository is the correct
 * (and only) way to read this entity for exactly that reason.
 */
export const deliveryZoneRepository = createMongooseRepository<DeliveryZoneSchema>({
  model: DeliveryZoneModel,
  entityName: "DeliveryZone",
});

export const pickupLocationRepository = createMongooseRepository<PickupLocationSchema>({
  model: PickupLocationModel,
  entityName: "PickupLocation",
});

export const cartRepository = createMongooseRepository<CartSchema>({
  model: CartModel,
  entityName: "Cart",
});

export const cartLineRepository = createMongooseRepository<CartLineSchema>({
  model: CartLineModel,
  entityName: "CartLine",
});

export const orderRepository = createMongooseRepository<OrderSchema>({
  model: OrderModel,
  entityName: "Order",
});

export const orderLineRepository = createMongooseRepository<OrderLineSchema>({
  model: OrderLineModel,
  entityName: "OrderLine",
});

export const paymentProofRepository = createMongooseRepository<PaymentProofSchema>({
  model: PaymentProofModel,
  entityName: "PaymentProof",
});

export const returnRepository = createMongooseRepository<ReturnSchema>({
  model: ReturnModel,
  entityName: "Return",
});

export const returnLineRepository = createMongooseRepository<ReturnLineSchema>({
  model: ReturnLineModel,
  entityName: "ReturnLine",
});

/**
 * Singleton configuration documents — at most one of each exists. Read and
 * written through `admin/settings/singleton-settings.ts`, never ad hoc.
 */
export const storeProfileRepository = createMongooseRepository<StoreProfileSchema>({
  model: StoreProfileModel,
  entityName: "StoreProfile",
});

export const storefrontContentRepository = createMongooseRepository<StorefrontContentSchema>({
  model: StorefrontContentModel,
  entityName: "StorefrontContent",
});

export const fulfilmentSettingsRepository = createMongooseRepository<FulfilmentSettingsSchema>({
  model: FulfilmentSettingsModel,
  entityName: "FulfilmentSettings",
});

export const paymentSettingsRepository = createMongooseRepository<PaymentSettingsSchema>({
  model: PaymentSettingsModel,
  entityName: "PaymentSettings",
});

export const notificationSettingsRepository = createMongooseRepository<NotificationSettingsSchema>({
  model: NotificationSettingsModel,
  entityName: "NotificationSettings",
});

export const operatingHoursRepository = createMongooseRepository<OperatingHoursSchema>({
  model: OperatingHoursModel,
  entityName: "OperatingHours",
});

export const inventorySettingsRepository = createMongooseRepository<InventorySettingsSchema>({
  model: InventorySettingsModel,
  entityName: "InventorySettings",
});

/** Append-only audit trail — written by `core/activity/record-activity.ts`, read by `/api/admin/activity`. */
export const activityLogRepository = createMongooseRepository<ActivityLogSchema>({
  model: ActivityLogModel,
  entityName: "ActivityLog",
});

export const wishlistRepository = createMongooseRepository<WishlistSchema>({
  model: WishlistModel,
  entityName: "Wishlist",
});

/** Backing store for the toolkit's `IdempotencyStore` — see `idempotency/mongo-idempotency-store.ts`. */
export const idempotencyRecordRepository = createMongooseRepository<IdempotencyRecordSchema>({
  model: IdempotencyRecordModel,
  entityName: "IdempotencyRecord",
});

/** Fixed-window counters — see `rate-limit/enforce-rate-limit.ts`. */
export const rateLimitRepository = createMongooseRepository<RateLimitSchema>({
  model: RateLimitModel,
  entityName: "RateLimit",
});

/** Append-only inventory audit rows, written by `engines/inventory/apply-stock-movement.ts`. */
export const stockMovementRepository = createMongooseRepository<StockMovementSchema>({
  model: StockMovementModel,
  entityName: "StockMovement",
});

/** Human-readable number counters — one document per sequence key, incremented with an atomic upsert. */
export const orderSequenceRepository = createMongooseRepository<OrderSequenceSchema>({
  model: OrderSequenceModel,
  entityName: "OrderSequence",
});

/** Public images uploaded but not yet seen referenced — what the orphan sweep works from (`catalog/pending-upload.schema.ts`). */
export const pendingUploadRepository = createMongooseRepository<PendingUploadSchema>({
  model: PendingUploadModel,
  entityName: "PendingUpload",
});

/** The single lock document that serialises every change to who is an active full-access Owner (`withOwnerGuard`). */
export const staffOwnerLockRepository = createMongooseRepository<StaffOwnerLockSchema>({
  model: StaffOwnerLockModel,
  entityName: "StaffOwnerLock",
});

/** The invoice-number counter — its own collection, independent of the order-number counter. */
export const invoiceSequenceRepository = createMongooseRepository<InvoiceSequenceSchema>({
  model: InvoiceSequenceModel,
  entityName: "InvoiceSequence",
});

export const returnSequenceRepository = createMongooseRepository<ReturnSequenceSchema>({
  model: ReturnSequenceModel,
  entityName: "ReturnSequence",
});

/** In-app notices for staff (`server/notifications`). Read state is per staff member; see the schema. */
export const staffNotificationRepository = createMongooseRepository<StaffNotificationSchema>({
  model: StaffNotificationModel,
  entityName: "StaffNotification",
});
