import { returnSequenceRepository } from "../../core/repositories";

/** The one counter document this engine increments — see `return-sequence.schema.ts`. */
const SEQUENCE_KEY = "return";

export function formatReturnNumber(sequence: number): string {
  return `RET-${String(sequence).padStart(6, "0")}`;
}

/**
 * Atomically allocates the next return number.
 *
 * **Must be called from inside the request-return transaction** — mirrors
 * `allocate-order-number.ts` exactly. Gap tolerance comes from the
 * transaction, not from this function: the counter's `$inc` rolls back
 * along with everything else on failure, so the next successful request
 * gets the same value.
 */
export async function allocateReturnNumber(): Promise<string> {
  const sequence = await returnSequenceRepository.updateAtomic({ key: SEQUENCE_KEY }, { $inc: { value: 1 } }, { upsert: true });

  if (!sequence || typeof sequence.value !== "number") {
    throw new Error(`Return number allocation returned an unexpected result: ${JSON.stringify(sequence)}`);
  }

  return formatReturnNumber(sequence.value);
}
