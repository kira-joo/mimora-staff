import { orderSequenceRepository } from "../../core/repositories";

/** The one counter document this engine increments — see `order-sequence.schema.ts`. */
const SEQUENCE_KEY = "order";

export function formatOrderNumber(sequence: number): string {
  return `ORD-${String(sequence).padStart(6, "0")}`;
}

/**
 * Atomically allocates the next order number.
 *
 * **Must be called from inside the placement transaction** — the repository
 * resolves the ambient session rather than accepting one as a parameter. Called
 * outside a transaction, it still runs (an atomic `$inc` needs no
 * transaction to be safe on its own), but then a placement failure after
 * allocation leaves a permanent gap instead of returning the number — the
 * whole reason Phase 3 requires it inside `withTransaction`.
 *
 * **Gap tolerance comes from the transaction, not from this function.**
 * Because the increment lives in the same transaction as the order document,
 * a rolled-back placement returns its number: the counter's `$inc` rolls back
 * along with everything else, and the next successful placement gets the same
 * value. This function does not need to and does not try to detect or repair
 * gaps itself.
 */
export async function allocateOrderNumber(): Promise<string> {
  const sequence = await orderSequenceRepository.updateAtomic({ key: SEQUENCE_KEY }, { $inc: { value: 1 } }, { upsert: true });

  if (!sequence || typeof sequence.value !== "number") {
    throw new Error(`Order number allocation returned an unexpected result: ${JSON.stringify(sequence)}`);
  }

  return formatOrderNumber(sequence.value);
}
