import type { Model } from "mongoose";
import { vi } from "vitest";

/**
 * Shared rollback-test tooling (the helper the older integration tests each carry a private copy of).
 *
 * A rollback test is only worth anything if a write has genuinely landed inside the transaction before the failure:
 * failing BEFORE the write proves nothing about atomicity. So {@link failAfterWrite} lets the real call run to
 * completion and THEN throws; {@link snapshotCollections} reads the raw documents (every field, including `select:
 * false` ones) so "no partial state" is a deep equality against the state before, not a count.
 */
const injected: Array<{ mockRestore(): void }> = [];

/** Lets the real write land, then fails the `nth` call to `target[method]` with `injected failure`. Works on a repository or a Mongoose model's static. */
export function failAfterWrite(target: object, method: string, nth = 1): { readonly calls: number } {
  const host = target as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = host[method]!.bind(target);
  const state = { calls: 0 };
  const spy = vi.spyOn(host, method).mockImplementation(async (...args: unknown[]) => {
    const result = await original(...args);
    state.calls += 1;
    if (state.calls === nth) throw new Error("injected failure");
    return result;
  });
  injected.push(spy);
  return state;
}

/** Call from `afterEach`. */
export function restoreInjectedFailures(): void {
  while (injected.length > 0) injected.pop()!.mockRestore();
}

/** Every raw document of each model's collection, in `_id` order — what "exactly as before" is compared against. */
export async function snapshotCollections(...models: Array<Pick<Model<object>, "collection">>): Promise<unknown[][]> {
  return Promise.all(models.map((model) => model.collection.find({}).sort({ _id: 1 }).toArray()));
}
