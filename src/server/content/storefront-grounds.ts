/**
 * The storefront's two page grounds — `--sf-canvas` on the light and dark
 * grounds in `store-platform/docs/design-system.md` §5 (owner decision
 * D-S0, 2026-10-12). Brand fills are measured and derived against these,
 * never against a merchant-entered surface: a surface is ground-dependent
 * and not brand-overridable (D-2), so the page a customer actually sees is
 * always one of these two.
 *
 * **Cross-repo invariant:** these must equal the storefront's own
 * `--sf-canvas` tokens. `GET /api/storefront/theme` returns them so the
 * storefront's contrast gate can assert the two agree rather than trusting
 * that someone remembered to change both.
 */
export const STOREFRONT_GROUNDS = {
  light: "#F7F5F1",
  dark: "#14130F",
} as const;

export type StorefrontGround = keyof typeof STOREFRONT_GROUNDS;

/**
 * Every background TEXT sits on, per ground — the canvas plus the card surface
 * and the muted surface (`--sf-canvas`, `--sf-surface`, `--sf-surface-muted` in
 * `store-platform/src/styles/tokens.css`; same cross-repo invariant). A brand
 * colour used as text must clear the minimum against the WORST of these, not
 * just the canvas: measured 2026-10-20, the derived dark accent cleared 4.5:1 on
 * the dark canvas and fell to 4.19:1 on the dark card surface it labels.
 */
export const STOREFRONT_SURFACES = {
  light: ["#F7F5F1", "#FFFFFF", "#EFEBE4"],
  dark: ["#14130F", "#1D1B16", "#24211B"],
} as const;

/** D-S4: the curated typography pairings — every one covers Arabic and Latin (design-system.md §7a). */
export const TYPOGRAPHY_CHOICES = ["default", "contemporary", "neutral"] as const;
export type TypographyChoice = (typeof TYPOGRAPHY_CHOICES)[number];
