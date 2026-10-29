import { BadRequestError } from "@kira-joo/backend-toolkit-core";
import { IdempotencyInFlightError, IdempotencyKeyReuseError, hashRequest } from "@kira-joo/backend-toolkit-next";
import type { NextRequest } from "next/server";
import { buildIdempotencyKey, mongoIdempotencyStore } from "./mongo-idempotency-store";

/**
 * Manual, actor-scoped idempotency. The toolkit's own `idempotent: true` route
 * option reads the raw `Idempotency-Key` header inside `create-route.ts`,
 * before any handler runs, and keys the claim on that string alone — globally,
 * across every actor. That is the "raw globally-unique client key is a
 * cross-user replay hazard" this repo's `CLAUDE.md` non-negotiable #8 forbids,
 * so `route-factories.ts` REFUSES `idempotent: true` at module load. This
 * module is the only way a route claims a key.
 *
 * **Who calls it:**
 * - Shop routes (order placement, payment-proof submission, returns, reviews,
 *   auth flows) call `claimIdempotentMutation` directly after resolving the
 *   customer or guest actor — see `app/api/shop/orders/route.ts`.
 * - Every admin money- or stock-moving write (payment verify / reject /
 *   refund, return receive / refund, order status transitions, expire-unpaid)
 *   goes through `runIdempotentMutation` (`run-idempotent-mutation.ts`), which
 *   wraps the three calls below: claim, run, store the response, release on
 *   failure. A staff request without an `Idempotency-Key` is a 400.
 *
 * **No second idempotency abstraction.** The store (`mongoIdempotencyStore`),
 * its race-safety (an atomic insert against `IdempotencyRecordModel`'s unique
 * index), `hashRequest()` and the `IdempotencyInFlightError` /
 * `IdempotencyKeyReuseError` taxonomy are the toolkit's own. This module only
 * adds what `idempotent: true` cannot: the key scoped by route + actor via
 * `buildIdempotencyKey(route, actorId, clientKey)` before the store is touched.
 *
 * @example
 * ```ts
 * // Inside a route handler, after the actor is resolved:
 * const claim = await claimIdempotentMutation({
 *   route: "POST /api/shop/orders",
 *   actorId: customer?._id.toString(),
 *   request,
 *   body,
 * });
 * if (!claim.claimed) return claim.cachedResponse.body; // already-completed replay
 *
 * try {
 *   const result = await placeOrder(...);
 *   await completeIdempotentMutation(claim, { status: 201, body: result });
 *   return result;
 * } catch (error) {
 *   await releaseIdempotentMutation(claim);
 *   throw error;
 * }
 * ```
 */

const IDEMPOTENCY_HEADER_NAME = "Idempotency-Key";

export interface ScopedIdempotencyClaim {
  /** `true` when this caller won the race and must run the mutation. `false` means a cached response is ready to replay. */
  claimed: boolean;
  /** Present only when `claimed` is `false` — the original request's completed response. */
  cachedResponse?: { status: number; body: unknown };
  /** Opaque to the caller beyond passing it to `completeIdempotentMutation`/`releaseIdempotentMutation` unchanged. */
  key: string;
  requestHash: string;
}

export interface ClaimIdempotentMutationOptions {
  /** A stable, route-identifying string — e.g. `"POST /api/shop/orders"`. Part of the scoping; must be the same string on every call for this route. */
  route: string;
  /** The resolved actor's id, or `undefined` for a legitimate guest action (see `buildIdempotencyKey`'s own doc comment for why that is still safe). */
  actorId: string | undefined;
  request: NextRequest;
  /** The validated request body — the same value `hashRequest` would be given, so a genuinely different request with a reused key is detected. */
  body: unknown;
}

/**
 * Claims the scoped idempotency key for this actor+route+client-key
 * combination, or returns the already-completed response to replay.
 *
 * @throws {BadRequestError} No `Idempotency-Key` header was supplied — this route requires one.
 * @throws {IdempotencyInFlightError} The original request for this exact key is still being processed (409).
 * @throws {IdempotencyKeyReuseError} The same key was presented with a different request body (422).
 */
export async function claimIdempotentMutation(options: ClaimIdempotentMutationOptions): Promise<ScopedIdempotencyClaim> {
  const clientKey = options.request.headers.get(IDEMPOTENCY_HEADER_NAME);
  if (!clientKey) {
    throw new BadRequestError(`This route requires an ${IDEMPOTENCY_HEADER_NAME} header.`);
  }

  const key = buildIdempotencyKey(options.route, options.actorId, clientKey);
  const requestHash = hashRequest(options.request.method, options.route, options.body);

  const claim = await mongoIdempotencyStore.begin(key, requestHash);

  if (claim.claimed) return { claimed: true, key, requestHash };

  if (!claim.record) throw new IdempotencyInFlightError();
  if (claim.record.requestHash !== requestHash) throw new IdempotencyKeyReuseError();

  return { claimed: false, cachedResponse: { status: claim.record.status, body: claim.record.body }, key, requestHash };
}

/** Stores the completed response so a later replay of the same scoped key returns it. Call once the mutation has genuinely succeeded. */
export async function completeIdempotentMutation(
  claim: Pick<ScopedIdempotencyClaim, "key" | "requestHash">,
  response: { status: number; body: unknown }
): Promise<void> {
  await mongoIdempotencyStore.complete(claim.key, { status: response.status, body: response.body, requestHash: claim.requestHash });
}

/**
 * Releases a claim whose mutation failed, so a genuine retry can proceed
 * rather than being told to wait for a request that will never complete.
 * Never throws — a release failure must not replace the real error the
 * caller is already propagating.
 */
export async function releaseIdempotentMutation(claim: Pick<ScopedIdempotencyClaim, "key">): Promise<void> {
  try {
    await mongoIdempotencyStore.release(claim.key);
  } catch (error) {
    console.warn(`[idempotency] failed to release ${claim.key}:`, error);
  }
}
