/**
 * The slug of the content-managed page holding the store's terms of sale —
 * `mimora-client/docs/legal-and-consent.md` §"The pages". Checkout asks a
 * customer to accept its current version, and the order records which one
 * (D-13).
 */
export const TERMS_PAGE_SLUG = "terms";

/**
 * Every legal page, in the order `legal-and-consent.md` §1 lists them. The
 * storefront footer always links whichever of these are published —
 * independently of the merchant's own footer navigation, which cannot
 * remove them (owner decision, 2026-10-12: "required legal links must
 * remain available").
 */
export const LEGAL_PAGE_SLUGS = ["terms", "privacy", "returns", "shipping", "cookies", "accessibility", "contact"] as const;
