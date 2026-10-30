/**
 * This application's own cache-tag vocabulary (MDS §12). Deliberately never
 * shared with `mimora-client` (the storefront) via a package — both apps
 * hand-maintain the same tag names and are contract-tested against each
 * other, exactly as the restaurant pair does.
 */
export const CacheTag = {
  PRODUCTS: "PRODUCTS",
  VARIANTS: "VARIANTS",
  CATEGORIES: "CATEGORIES",
  COLLECTIONS: "COLLECTIONS",
  BRANDS: "BRANDS",
  REVIEWS: "REVIEWS",
  STORE_PROFILE: "STORE_PROFILE",
  THEME: "THEME",
  CONTENT: "CONTENT",
  FULFILMENT: "FULFILMENT",
  PROMOTIONS: "PROMOTIONS",
} as const;
