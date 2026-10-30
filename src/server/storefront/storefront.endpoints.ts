/**
 * `/api/storefront/**` path constants — the single source of truth for
 * every path on this surface, per the workspace's "no API path is ever
 * hardcoded at a call site" rule.
 *
 * Next's file-based routing is already the source of truth for what each
 * `route.ts` actually serves — this module does not change that. Its job
 * is everywhere ELSE a storefront path needs to be written: this batch's
 * own tests (so a route rename is one edit, not a find-and-replace across
 * every test file), and any future caller inside this repo that needs to
 * reference a storefront path (there is none yet). A separate consuming
 * application (`mimora-client`) hand-maintains its own equivalent, per
 * this workspace's rule that route strings carry zero shared-package
 * value and never move into a package.
 */
export const StorefrontRoutes = {
  STORE_PROFILE: "/api/storefront/store-profile",
  THEME: "/api/storefront/theme",
  CONTENT: "/api/storefront/content",
  FULFILMENT_SETTINGS: "/api/storefront/fulfilment-settings",
  PAYMENT_METHODS: "/api/storefront/payment-methods",
  OPERATING_HOURS: "/api/storefront/operating-hours",
  DELIVERY_ZONES: "/api/storefront/delivery-zones",
  PICKUP_LOCATIONS: "/api/storefront/pickup-locations",
  CATEGORIES: "/api/storefront/categories",
  COLLECTIONS: "/api/storefront/collections",
  BRANDS: "/api/storefront/brands",
  PRODUCTS: "/api/storefront/products",
  PRODUCT_DETAIL: (slug: string) => `/api/storefront/products/${slug}`,
  FACETS: "/api/storefront/facets",
  SIZE_GUIDE_DETAIL: (id: string) => `/api/storefront/size-guides/${id}`,
  REVIEWS_FOR_PRODUCT: (productId: string) => `/api/storefront/reviews/${productId}`,
  PROMOTIONS_ACTIVE: "/api/storefront/promotions/active",
  PAGE_DETAIL: (slug: string) => `/api/storefront/pages/${slug}`,
  SEARCH: "/api/storefront/search",
} as const;
