import { customerRepository } from "../../core/repositories";
import { sendPasswordResetMessage } from "../../core/mail/send-account-emails";
import { findCustomerByPhone } from "./find-customer-by-phone";
import { mintPasswordResetToken } from "./mint-password-reset-token";

/**
 * Mints and stores a password-reset token for whichever customer matches
 * `identifier` (phone or email, per D-9) — and does nothing observable if
 * none matches.
 *
 * **Always resolves the same way regardless of whether an account was
 * found** — the same enumeration-oracle principle MDS §19 states for
 * login applies here: a forgot-password endpoint that responds
 * differently for "account exists" vs "account does not exist" is exactly
 * as much of an account-existence oracle as a login endpoint that does.
 * Unknown accounts return before the token write and notification, so the
 * response is identical but the work is not — a small timing residual, bounded
 * by the per-IP+identifier rate limit; closing it needs the send moved off the
 * request path.
 * The caller (the route) always returns one generic "if an account
 * matches, a reset link was sent" message.
 */
export async function requestPasswordReset(identifier: string): Promise<void> {
  // Phone first (canonical, then legacy stored forms), then email — the identifier may be either.
  const customer =
    (await findCustomerByPhone(identifier)) ??
    (await customerRepository.findOne({ where: { email: identifier.toLowerCase() }, skipThrowError: true }));
  if (!customer) return;

  const { token } = await mintPasswordResetToken(customer._id);

  await sendPasswordResetMessage({ email: customer.email ?? undefined, phone: customer.phone }, token);
}
