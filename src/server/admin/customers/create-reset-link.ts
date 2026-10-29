import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { customerRepository } from "../../core/repositories";
import { mintPasswordResetToken } from "../../shop/auth/mint-password-reset-token";

export interface ResetLinkResult {
  _id: string;
  /** The plaintext credential — shown once by the console, never stored (only its hash is) and never logged. */
  token: string;
  expiresAt: Date;
  /** The storefront path that takes the token. */
  resetPath: string;
  /** The full link, when the storefront's origin is known (derived from `STOREFRONT_REVALIDATE_URL`); otherwise staff hand over `resetPath` on the storefront's own domain. */
  resetUrl?: string;
}

/**
 * The storefront's origin, derived from the one storefront URL this backend is
 * already required to know (`STOREFRONT_REVALIDATE_URL`, the cache-invalidation
 * endpoint) rather than a second setting that could disagree with it. `undefined`
 * when absent or malformed — the console then shows the path alone.
 */
export function storefrontOrigin(configured: string | undefined = process.env.STOREFRONT_REVALIDATE_URL): string | undefined {
  if (!configured) return undefined;
  try {
    return new URL(configured).origin;
  } catch {
    return undefined;
  }
}

/**
 * Staff-assisted password recovery (plan #70). Email delivery is not available
 * (D-8), so a customer who cannot reach their account asks the store, and staff
 * mint a reset credential and deliver it by another channel.
 *
 * It is the SAME credential `forgot-password` mints — `mintPasswordResetToken`:
 * same entropy, SHA-256-hashed at rest, same one-hour lifetime, single-use,
 * redeemed at the same `reset-password` route (which also signs the customer out
 * everywhere). Minting replaces any outstanding token. A redacted account has no
 * credentials to recover and is refused.
 */
export async function createCustomerResetLink(customerId: string): Promise<ResetLinkResult> {
  const customer = await customerRepository.findOne({ where: { _id: customerId }, skipThrowError: true });
  if (!customer) throw new NotFoundError("Customer not found");
  if (customer.redactedAt) throw new ConflictError("A redacted customer has no account to recover.");

  const { token, expiresAt } = await mintPasswordResetToken(customer._id);
  const resetPath = `/reset-password?token=${encodeURIComponent(token)}`;
  const origin = storefrontOrigin();
  return { _id: customer._id.toString(), token, expiresAt, resetPath, ...(origin ? { resetUrl: `${origin}${resetPath}` } : {}) };
}
