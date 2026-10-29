import { UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import { comparePassword, hashPassword } from "@kira-joo/backend-toolkit-next";
import type { CartMergeResult } from "../cart/merge-guest-cart";
import { findCustomerByPhone } from "./find-customer-by-phone";
import { issueCustomerSession } from "./issue-customer-session";

export interface LoginResult {
  _id: string;
  name: string;
  phone: string;
  email?: string;
}

/**
 * A real, valid-format hash of a value nobody will ever actually type,
 * computed once and cached — not a hardcoded string. A hardcoded constant
 * that fails `comparePassword`'s own format parsing would make the
 * unknown-account path dramatically faster than the real-account path,
 * silently reinstating the timing side-channel this decoy exists to close
 * (MDS §19, restated for customer login — the same rule the workspace
 * authentication doc states for staff, and nothing in it scopes the rule
 * to staff only).
 */
/** Sign-in/sign-up response: the customer, plus what happened to a guest cart presented with the request. */
export interface AuthResponse extends LoginResult {
  cartMerge: CartMergeResult;
}

let decoyHash: Promise<string> | undefined;
function getDecoyHash(): Promise<string> {
  return (decoyHash ??= hashPassword(`decoy-${Math.random().toString(36)}`));
}

/**
 * Authenticates a customer by phone + password, issues a session (cookies
 * written as a side effect — see `issueCustomerSession`), and returns the
 * customer's own display identity, never a token.
 *
 * **One identical error for every failure** — unknown phone, wrong
 * password, or (implicitly, since there is no separate "disabled" state on
 * `CustomerSchema` yet) any other rejection. The password comparison runs
 * even when no account exists, against `getDecoyHash()`, so the two paths
 * take the same real cryptographic work and an attacker cannot use timing
 * to enumerate valid phone numbers.
 *
 * The phone is matched in canonical form first, then in the legacy forms an
 * account registered before phone normalisation may still be stored under
 * (`findCustomerByPhone`), so nobody is locked out by the change.
 *
 * Rate-limit clearing on success is the route's job, not this function's —
 * the rate-limit key is `IP+phone` (MDS §11.5), and this function has no
 * access to the request's IP.
 */
export async function loginCustomer(phone: string, password: string): Promise<LoginResult> {
  // Direct Model read: `passwordHash` is `select: false`, which the repository projection never returns by design.
  const customer = await findCustomerByPhone(phone, { withPasswordHash: true });

  const matches = await comparePassword(password, customer?.passwordHash ?? (await getDecoyHash()));

  if (!customer || !matches) {
    throw new UnauthorizedError("Invalid phone number or password.");
  }

  await issueCustomerSession({ _id: customer._id, tokenVersion: customer.tokenVersion });

  return { _id: customer._id.toString(), name: customer.name, phone: customer.phone, email: customer.email };
}
