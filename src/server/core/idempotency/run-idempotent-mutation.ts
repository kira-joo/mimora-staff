import type { NextRequest } from "next/server";
import { auditSubject, markIdempotentReplay, type ActivitySubject } from "../activity/record-activity";
import { claimIdempotentMutation, completeIdempotentMutation, releaseIdempotentMutation } from "./scoped-idempotency";

export interface RunIdempotentMutationOptions<TResult extends object> {
  /** Stable route identity, e.g. `"PUT /api/admin/orders/:id/payment/refund"` — part of the key's scope. */
  route: string;
  /** The signed-in staff member. Scopes the key, so two staff presenting the same client key never collide. */
  actorId: string;
  request: NextRequest;
  /**
   * Everything that makes this request *this* request: the validated body AND the route params. The key is
   * fingerprinted over it, so one key reused on a different order is a 422, never a silent replay of the first.
   */
  fingerprint: unknown;
  /** Applied to the result on first run AND on replay, so the audit entry names the same record either way. */
  subject?: ActivitySubject;
  mutation: () => Promise<TResult>;
}

/**
 * The shape every admin money-moving write shares: claim the scoped
 * `Idempotency-Key` first, run the mutation once, store the response, and
 * replay it for a retry of the same action (a refund recorded once, not
 * twice). A failed mutation releases its claim so a genuine retry can run.
 *
 * The stored body is the JSON the client would have received, not the live
 * document — a replay must return exactly what the original did, and a
 * Decimal or ObjectId round-tripped through the store is neither.
 *
 * A replay is NOT audited: it is marked (`markIdempotentReplay`) and the route
 * factory's audit wrapper skips it, because it changed nothing — the first
 * request's entry already records the action, and a second would read as a
 * second refund.
 */
export async function runIdempotentMutation<TResult extends object>(options: RunIdempotentMutationOptions<TResult>): Promise<TResult> {
  const { route, actorId, request, fingerprint, subject, mutation } = options;
  const mark = <T extends object>(value: T): T => (subject ? auditSubject(value, subject) : value);

  const claim = await claimIdempotentMutation({ route, actorId, request, body: fingerprint });
  if (!claim.claimed) return markIdempotentReplay(mark(claim.cachedResponse!.body as TResult));

  let result: TResult;
  try {
    result = await mutation();
  } catch (error) {
    await releaseIdempotentMutation(claim);
    throw error;
  }

  // Outside the try on purpose: a mutation that SUCCEEDED must never release its claim because storing the
  // response failed — that would let a retry apply it twice. A stuck claim is a 409 until it expires; a double refund is not recoverable.
  await completeIdempotentMutation(claim, { status: 200, body: JSON.parse(JSON.stringify(result)) });
  return mark(result);
}
