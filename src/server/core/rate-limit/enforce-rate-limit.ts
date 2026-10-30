import { AppError } from "@kira-joo/backend-toolkit-core";
import { rateLimitRepository } from "../repositories";
import { normalizeStorePhone } from "../phone/store-phone";

/**
 * Rate limiting backed by MongoDB rather than process memory — the same
 * reasoning `restaurant-platform-staff`'s own (`nutrition-staff`'s in-memory
 * `Map` limiter explicitly self-flags "if the deploy target becomes
 * multi-instance, replace this — do not copy this file," which is exactly
 * the trap a per-process store falls into: any serverless or multi-instance
 * deployment gives each instance its own counter, and the effective limit
 * becomes the configured limit times the instance count. Not a limit.
 *
 * A fixed window, not a sliding one — up to 2× the configured limit across
 * two adjacent windows is a real, accepted weakness: the purpose is
 * stopping credential stuffing and runaway retries, not metering an API
 * precisely.
 */
export class RateLimitExceededError extends AppError {
  readonly statusCode = 429;
  readonly code = "RATE_LIMIT_EXCEEDED";

  constructor(
    /** Seconds until the window resets. */
    public readonly retryAfterSeconds: number,
    message = "Too many attempts. Please wait and try again."
  ) {
    super(message, { retryAfterSeconds });
  }
}

export interface RateLimitOptions {
  key: string;
  maxAttempts: number;
  windowMs: number;
}

/**
 * Records an attempt and throws once the limit is exceeded.
 *
 * The increment and the expiry anchor are one atomic `findOneAndUpdate` —
 * a read-then-write lets concurrent attempts each read the same count,
 * exactly the scenario an attacker produces by firing requests in parallel.
 * `$setOnInsert` anchors the window to the FIRST attempt, so a sustained
 * attack cannot push the expiry forward on every request and keep the
 * window open indefinitely.
 */
export async function enforceRateLimit(options: RateLimitOptions): Promise<void> {
  const { key, maxAttempts, windowMs } = options;
  const now = Date.now();

  const record = await rateLimitRepository.updateAtomic(
    { key },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now + windowMs) } },
    { upsert: true, skipThrowError: true }
  );

  if (!record) return;

  if (record.count > maxAttempts) {
    const retryAfterSeconds = Math.max(1, Math.ceil((record.expiresAt.getTime() - now) / 1000));
    throw new RateLimitExceededError(retryAfterSeconds);
  }
}

/**
 * Clears a key's counter — call after a SUCCESSFUL attempt on a limit like
 * `LOGIN`, so ordinary human error (a mistyped password, corrected on the
 * next try) does not accumulate toward a lockout.
 */
export async function clearRateLimit(key: string): Promise<void> {
  await rateLimitRepository.delete({ where: { key }, skipThrowError: true });
}

/**
 * The client's address, for keying a limit — and the trust model behind it.
 *
 * **Only a value a TRUSTED proxy wrote is believed.** `x-forwarded-for` is a
 * list: each proxy appends the address it saw the request come from, so the
 * entries to the LEFT of the trusted ones are whatever the client chose to send.
 * The first entry is therefore entirely client-controlled — trusting it lets a
 * caller rotate a made-up address per request and walk past every per-IP limit
 * (the previous implementation did exactly that). The right-most entry is the
 * one our nearest proxy appended.
 *
 * Two senders reach this backend, and both are covered:
 *  - the storefront's BFF (`mimora-client/src/lib/session/shop-request.ts`)
 *    forwards ONE address: the right-most entry of ITS own `x-forwarded-for`. With
 *    no proxy in front of this backend, that single value is the right-most
 *    entry here too;
 *  - the staff console's browsers, behind the platform's proxy.
 *
 * `CLIENT_IP_TRUSTED_HOPS` (default `1`) is how many right-most entries belong to
 * infrastructure we control. Put one more proxy in front of this backend, which
 * appends the BFF's own address after the forwarded client, and set it to `2`.
 * `x-real-ip` is believed only when `TRUST_X_REAL_IP=1` says the proxy overwrites
 * it (the same flag the BFF reads). With no usable header the answer is
 * `"unknown"` — one shared bucket, which fails closed (stricter), never open.
 *
 * Still not a security boundary on its own: a caller that can reach this
 * backend DIRECTLY can send any header. The backend must not be reachable
 * except through the BFF or the proxy; the limits are paired with generic
 * error messages for that reason.
 */
export function resolveClientIp(request: Request): string {
  if (process.env.TRUST_X_REAL_IP === "1") {
    const real = request.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  const hops = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  if (!hops?.length) return "unknown";
  const trusted = Number.parseInt(process.env.CLIENT_IP_TRUSTED_HOPS ?? "1", 10);
  const fromRight = Number.isInteger(trusted) && trusted >= 1 ? trusted : 1;
  return hops[Math.max(0, hops.length - fromRight)] ?? "unknown";
}

/**
 * The canonical form of a typed login identifier, for keying a per-ACCOUNT
 * limit: a phone in its canonical E.164-ish form (so `0100 123 4567` and
 * `+201001234567` share one counter), an email lower-cased and trimmed. Without
 * this an attacker gets a fresh budget per spelling of the same account.
 */
export function normalizeAccountIdentifier(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.includes("@") ? trimmed.toLowerCase() : normalizeStorePhone(trimmed);
}

/**
 * Enforces BOTH limits an abuse-prone, unauthenticated route needs: one
 * counter per client address (a sprayed password, or one source working through
 * many accounts) and one per ACCOUNT (a targeted account, however many
 * addresses the attacker rotates through) — the pair staff login already uses.
 * Returns the account key, so a success can clear it (never the address key:
 * a successful login says nothing about the address's other attempts).
 *
 * The address counter is checked first and both are always incremented in that
 * order, so a request refused for its address never spends account budget.
 */
export async function enforceAddressAndAccountLimits(options: {
  request: Request;
  scope: string;
  identifier: string;
  address: { maxAttempts: number; windowMs: number };
  account: { maxAttempts: number; windowMs: number };
}): Promise<{ accountKey: string }> {
  const { request, scope, identifier, address, account } = options;
  const accountKey = `${scope}:account:${normalizeAccountIdentifier(identifier)}`;
  await enforceRateLimit({ key: `${scope}:ip:${resolveClientIp(request)}`, ...address });
  await enforceRateLimit({ key: accountKey, ...account });
  return { accountKey };
}

/**
 * The limits, in one table — matches MDS §11.5's list exactly (login,
 * signup, password reset, verification resend, promotion validation,
 * review submission, order placement — 7 routes, not 8; the architecture
 * review's re-reading of §11.5's own sentence found the prior plan's "8"
 * count never named an 8th route). Auth surfaces are tight because they are
 * the ones worth attacking; order placement and review submission are
 * looser — a legitimate customer retrying a failed checkout must not be
 * locked out mid-purchase.
 */
export const RATE_LIMITS = {
  LOGIN: { maxAttempts: 8, windowMs: 15 * 60_000 },
  /**
   * The per-address half of customer login, deliberately looser than the
   * per-account half: many people share one address (a household, a café, a
   * mobile carrier's NAT) and every attempt counts, successes included.
   */
  LOGIN_ADDRESS: { maxAttempts: 30, windowMs: 15 * 60_000 },
  SIGNUP: { maxAttempts: 5, windowMs: 60 * 60_000 },
  /** One phone number being registered over and over, from any number of addresses. */
  SIGNUP_IDENTIFIER: { maxAttempts: 5, windowMs: 60 * 60_000 },
  PASSWORD_RESET_REQUEST: { maxAttempts: 5, windowMs: 60 * 60_000 },
  PASSWORD_RESET_REQUEST_ADDRESS: { maxAttempts: 20, windowMs: 60 * 60_000 },
  VERIFICATION_RESEND: { maxAttempts: 5, windowMs: 60 * 60_000 },
  VERIFICATION_RESEND_ADDRESS: { maxAttempts: 20, windowMs: 60 * 60_000 },
  NEWSLETTER_SUBSCRIBE: { maxAttempts: 10, windowMs: 60 * 60_000 },
  PROMOTION_VALIDATION: { maxAttempts: 30, windowMs: 10 * 60_000 },
  REVIEW_SUBMISSION: { maxAttempts: 10, windowMs: 60 * 60_000 },
  ORDER_PLACEMENT: { maxAttempts: 20, windowMs: 10 * 60_000 },
  PAYMENT_PROOF_SUBMISSION: { maxAttempts: 10, windowMs: 60 * 60_000 },
  RETURN_REQUEST: { maxAttempts: 10, windowMs: 60 * 60_000 },
  PROFILE_UPDATE: { maxAttempts: 20, windowMs: 60 * 60_000 },
  PASSWORD_CHANGE: { maxAttempts: 5, windowMs: 60 * 60_000 },
  ADDRESS_MUTATION: { maxAttempts: 30, windowMs: 60 * 60_000 },
  WISHLIST_MUTATION: { maxAttempts: 60, windowMs: 60 * 60_000 },
} as const;
