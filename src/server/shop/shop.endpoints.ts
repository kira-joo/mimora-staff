/**
 * `/api/shop/**` path constants — the single source of truth for every
 * path on this surface, per the workspace's "no API path is ever
 * hardcoded at a call site" rule. See `storefront.endpoints.ts` for the
 * same pattern on the sibling surface.
 */
export const ShopRoutes = {
  CART: "/api/shop/cart",
  CART_LINES: "/api/shop/cart/lines",
  CART_LINE_DETAIL: (lineId: string) => `/api/shop/cart/lines/${lineId}`,
  CART_FULFILMENT: "/api/shop/cart/fulfilment",
  CART_PROMOTION: "/api/shop/cart/promotion",
  AUTH_LOGIN: "/api/shop/auth/login",
  AUTH_SIGNUP: "/api/shop/auth/signup",
  AUTH_REFRESH: "/api/shop/auth/refresh",
  AUTH_LOGOUT: "/api/shop/auth/logout",
  AUTH_FORGOT_PASSWORD: "/api/shop/auth/forgot-password",
  AUTH_RESET_PASSWORD: "/api/shop/auth/reset-password",
  AUTH_VERIFY_EMAIL: "/api/shop/auth/verify-email",
  AUTH_RESEND_VERIFICATION: "/api/shop/auth/resend-verification",
} as const;
