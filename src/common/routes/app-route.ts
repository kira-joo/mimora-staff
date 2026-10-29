/** Every Staff UI route, in one place. Builders for dynamic segments. */
export const AppRoute = {
  HOME: "/",
  LOGIN: "/login",
  ACCEPT_INVITE: "/accept-invite",
  ORDERS: "/orders",
  ORDER: (id: string) => `/orders/${encodeURIComponent(id)}`,
  ORDERS_BOARD: "/orders/board",
  /** Printable documents: outside the console shell, so there is no app chrome to hide. */
  PRINT_INVOICE: (orderId: string) => `/print/orders/${encodeURIComponent(orderId)}/invoice`,
  PRINT_PACKING_SLIP: (orderId: string) => `/print/orders/${encodeURIComponent(orderId)}/packing-slip`,
  PRINT_PICKING_LIST: (orderIds: readonly string[]) => `/print/picking-list?ids=${orderIds.map(encodeURIComponent).join(",")}`,
  PAYMENTS: "/orders/payments",
  RETURNS: "/returns",
  RETURN: (id: string) => `/returns/${encodeURIComponent(id)}`,
  INVENTORY: "/inventory",
  INVENTORY_ADJUSTMENTS: "/inventory/adjustments",
  BRANDS: "/catalog/brands",
  BRAND_NEW: "/catalog/brands/new",
  BRAND: (id: string) => `/catalog/brands/${id}`,
  PRODUCTS: "/catalog/products",
  PRODUCT_NEW: "/catalog/products/new",
  PRODUCT: (id: string) => `/catalog/products/${encodeURIComponent(id)}`,
  CATEGORIES: "/catalog/categories",
  CATEGORY_NEW: "/catalog/categories/new",
  CATEGORY: (id: string) => `/catalog/categories/${encodeURIComponent(id)}`,
  COLLECTIONS: "/catalog/collections",
  COLLECTION_NEW: "/catalog/collections/new",
  COLLECTION: (id: string) => `/catalog/collections/${encodeURIComponent(id)}`,
  CATALOG_IMPORTS: "/catalog/imports",
  CATALOG_IMPORT: (id: string) => `/catalog/imports/${encodeURIComponent(id)}`,
  SIZE_GUIDES: "/catalog/size-guides",
  SIZE_GUIDE_NEW: "/catalog/size-guides/new",
  SIZE_GUIDE: (id: string) => `/catalog/size-guides/${encodeURIComponent(id)}`,
  PROMOTIONS: "/promotions",
  PROMOTION_NEW: "/promotions/new",
  PROMOTION: (id: string) => `/promotions/${encodeURIComponent(id)}`,
  CUSTOMERS: "/customers",
  CUSTOMER: (id: string) => `/customers/${encodeURIComponent(id)}`,
  REVIEWS: "/reviews",
  NEWSLETTER: "/newsletter",
  PAGES: "/content/pages",
  PAGE_NEW: "/content/pages/new",
  PAGE: (id: string) => `/content/pages/${encodeURIComponent(id)}`,
  STOREFRONT_CONTENT: "/content/storefront",
  DELIVERY_ZONES: "/fulfilment/delivery-zones",
  DELIVERY_ZONE_NEW: "/fulfilment/delivery-zones/new",
  DELIVERY_ZONE: (id: string) => `/fulfilment/delivery-zones/${encodeURIComponent(id)}`,
  PICKUP_LOCATIONS: "/fulfilment/pickup-locations",
  PICKUP_LOCATION_NEW: "/fulfilment/pickup-locations/new",
  PICKUP_LOCATION: (id: string) => `/fulfilment/pickup-locations/${encodeURIComponent(id)}`,
  FULFILMENT_SETTINGS: "/fulfilment/settings",
  OPERATING_HOURS: "/fulfilment/hours",
  STORE_SETTINGS: "/settings/store",
  THEME_SETTINGS: "/settings/theme",
  PAYMENT_SETTINGS: "/settings/payment",
  INVENTORY_SETTINGS: "/settings/inventory",
  NOTIFICATION_SETTINGS: "/settings/notifications",
  /** The staff notification feed (the bell's "View all"). Distinct from NOTIFICATION_SETTINGS, which configures customer messages. */
  NOTIFICATIONS: "/notifications",
  TEAM: "/team",
  TEAM_INVITE: "/team/invite",
  TEAM_MEMBER: (id: string) => `/team/${encodeURIComponent(id)}`,
  ROLES: "/team/roles",
  REPORTS: "/reports",
  ACTIVITY: "/activity",
} as const;

/** Screens used signed-out. A 401 on them is an answer (wrong password, bad code), never a lost session. */
export const SIGNED_OUT_ROUTES: readonly string[] = [AppRoute.LOGIN, AppRoute.ACCEPT_INVITE];

/**
 * Where to send someone after signing in. Only a same-origin path is
 * accepted — `//evil.example` and absolute URLs fall back to home, so the
 * login page can never be turned into an open redirect.
 */
export function safeRedirectPath(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\")) return AppRoute.HOME;
  if (candidate === AppRoute.LOGIN || candidate.startsWith(`${AppRoute.LOGIN}?`)) return AppRoute.HOME;
  return candidate;
}
