import { invoiceSequenceRepository } from "../core/repositories";

/** The one counter document this engine increments — see `invoice-sequence.schema.ts`. */
const SEQUENCE_KEY = "invoice";

export function formatInvoiceNumber(sequence: number): string {
  return `INV-${String(sequence).padStart(6, "0")}`;
}

/**
 * Atomically allocates the next invoice number.
 *
 * **Must be called from inside the placement transaction**, exactly like `allocateOrderNumber`: the repository
 * resolves the ambient session, so the counter's `$inc` commits or rolls back together with the order that carries
 * the number. A placement that fails after allocating therefore returns its number — no gap from a failure. The
 * only way a number is ever "used up" is a committed order, and a committed order keeps its number for good: a
 * cancelled order's invoice is shown as void, never renumbered and never reused. Voiding is not a counter operation
 * at all, which is why it cannot introduce a gap.
 */
export async function allocateInvoiceNumber(): Promise<string> {
  const sequence = await invoiceSequenceRepository.updateAtomic({ key: SEQUENCE_KEY }, { $inc: { value: 1 } }, { upsert: true });

  if (!sequence || typeof sequence.value !== "number") {
    throw new Error(`Invoice number allocation returned an unexpected result: ${JSON.stringify(sequence)}`);
  }

  return formatInvoiceNumber(sequence.value);
}
