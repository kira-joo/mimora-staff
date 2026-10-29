import { DuplicateKeyError } from "@kira-joo/backend-toolkit-core";
import type { IdempotencyRecord, IdempotencyStore } from "@kira-joo/backend-toolkit-next";
import { idempotencyRecordRepository } from "../repositories";

/** How long a completed record stays replayable. Well past any reasonable client retry. */
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The application's idempotency store, backed by MongoDB — replaces a
 * bespoke local design (Phase 4A.5) with the toolkit's own
 * `IdempotencyStore` contract, modelled directly on
 * `restaurant-platform-staff`'s working implementation of the same
 * interface (a proven shape, not a hypothetical one) rather than
 * reinventing the race-safety reasoning from scratch.
 *
 * **`begin` is atomic because the database makes it so**, not because of the
 * code around it. The insert either succeeds — this caller owns the key —
 * or violates the unique index on `key` and throws a duplicate-key error,
 * meaning someone else got there first. Deliberately no find-then-insert:
 * between those two statements a second request could insert, and both
 * would proceed, exactly the double-submit this mechanism exists to
 * prevent.
 */
export const mongoIdempotencyStore: IdempotencyStore = {
  async begin(key, requestHash) {
    try {
      await idempotencyRecordRepository.save({
        key,
        requestHash,
        expiresAt: new Date(Date.now() + RECORD_TTL_MS),
      });
      return { claimed: true };
    } catch (error) {
      if (!(error instanceof DuplicateKeyError)) throw error;

      const existing = await idempotencyRecordRepository.findOne({ where: { key }, skipThrowError: true });

      /*
       * Vanishingly rare, but real: the record can expire between the
       * failed insert and this read. Reporting "claimed by someone else, no
       * record" yields a 409, and the client's retry then succeeds —
       * strictly better than reporting success for work that never ran.
       */
      if (!existing) return { claimed: false };

      // `status` is only written on completion, so its absence means the
      // original request is still in flight.
      const record: IdempotencyRecord | undefined =
        existing.status === undefined
          ? undefined
          : { status: existing.status, body: existing.body, requestHash: existing.requestHash };

      return { claimed: false, record };
    }
  },

  async complete(key, record) {
    // `skipThrowError`: completing a record that already expired is a no-op, as before.
    await idempotencyRecordRepository.updateAtomic(
      { key },
      { $set: { status: record.status, body: record.body, requestHash: record.requestHash } },
      { skipThrowError: true }
    );
  },

  async release(key) {
    // Deleted rather than marked failed: only a success is worth replaying, and
    // a client retrying after a 500 must be able to genuinely retry.
    await idempotencyRecordRepository.delete({ where: { key }, skipThrowError: true });
  },
};

/**
 * Constructs the scoped key `claimIdempotentMutation` hands to the store
 * (`idempotent: true` is refused by `route-factories.ts`) — this repo's own `CLAUDE.md` non-negotiable #8: "scoped by route and
 * actor before uniqueness — a raw global client key is a cross-user replay
 * hazard." `IdempotencyStore.begin()` only accepts a flat string, so the
 * scoping lives in how that string is built, not in a separate schema
 * field.
 *
 * `actorId` is `undefined` for a guest checkout — the route path plus the
 * client-supplied key alone still scope two different guests' identical
 * `Idempotency-Key` header values apart in practice (a guest has no stable
 * identity across requests to collide on), but a signed-in actor's id is
 * included whenever available so one customer's key can never collide with
 * another's.
 */
export function buildIdempotencyKey(route: string, actorId: string | undefined, clientKey: string): string {
  return `${route}:${actorId ?? "guest"}:${clientKey}`;
}
