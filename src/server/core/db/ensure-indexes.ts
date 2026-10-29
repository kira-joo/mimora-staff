import type { Model } from "mongoose";
import { ALL_MODELS } from "./model-registry";

/**
 * Guarantees every declared index exists before the application serves a
 * request, and fails loudly if one does not.
 *
 * ## Why this is a correctness concern rather than a performance one
 *
 * A unique index is not an optimisation here — several of this application's
 * safety properties *are* the index, and the code around them is written on
 * that assumption:
 *
 * - **Idempotency.** `begin()` inserts and treats a duplicate-key error as
 *   "someone else won". With no index, both inserts succeed and both callers
 *   are told they own the key. That is a double-submit becoming two orders,
 *   silently, on the money path.
 * - **Customer phone/email.** Signup pre-checks with `exists()` backed by the
 *   unique index for correctness. Without the index, concurrent signups create
 *   two accounts on one phone.
 * - **SKU uniqueness.** Each variant's SKU must be globally unique. Without the
 *   index, duplicate SKUs are silently accepted.
 * - **variantKey uniqueness.** Enforces "exactly one variant per axis combination".
 *   Without it, duplicate variants are created.
 * - **Order numbers.** The counter's upsert is only atomic against a
 *   concurrent insert because of the index; without it, concurrent callers
 *   each create their own counter and each is handed `0001`.
 *
 * None of these fail loudly when the index is absent. They quietly stop being
 * true.
 *
 * ## Why the indexes could be absent at all
 *
 * Mongoose builds declared indexes in the BACKGROUND when a model is first
 * used, and no operation waits for that to finish. The window is small on an
 * idle machine and wide under load — which is exactly when concurrent requests
 * arrive.
 *
 * ## Build, or assert and refuse to start?
 *
 * Both are defensible and the trade-off is worth stating rather than defaulting.
 *
 * **Asserting only** is the right end state for a large production database.
 * Building an index on a live collection is expensive, and having an arbitrary
 * request trigger it is how a deploy turns into an outage. Indexes get created
 * by a deploy step, and the application refuses to serve if they are missing.
 *
 * **This builds, then asserts**, for three reasons specific to where this
 * product currently is:
 *
 * 1. Mongoose's own background build (`autoIndex`) is turned off in connect.ts so
 *    nothing is written to a database before its store identity is verified;
 *    the build therefore happens here, explicitly, and is awaited.
 * 2. There is no deploy-time index step yet. Assert-only would refuse to start
 *    against any fresh database — every new environment, every CI run, every
 *    developer's first `docker compose up`.
 * 3. The collections are small and the product is pre-release, so the
 *    expensive-first-build case does not exist yet.
 *
 * **The trigger for changing this** is real production volume: at that point
 * set `autoIndex: false`, create indexes in the deploy pipeline, and drop the
 * build half here — the verification half already does the right thing and
 * would need no change.
 *
 * The assert half runs unconditionally either way, so a build that silently
 * fails is still a startup failure rather than a silent loss of a guarantee.
 */
export async function ensureIndexes(models: Model<never>[] = ALL_MODELS): Promise<void> {
  /*
   * `Model.init()` resolves once the model's declared indexes are built. It is
   * the promise Mongoose already created for its own background build, so
   * awaiting it joins that work rather than duplicating it, and it memoises —
   * a second call costs microseconds.
   *
   * Failures are collected rather than thrown, because the most likely one is
   * also the most important to report clearly: a unique index cannot be built
   * over data that already contains duplicates. That is precisely the state
   * this check exists to detect — it means the guarantee was already lost and
   * the data needs reconciling before it can come back. Mongoose's own error
   * for it says "Index build failed" and names a dup key, with nothing about
   * what depended on that index.
   */
  const buildFailures = (
    await Promise.all(
      models.map(async (model) =>
        model
          .init()
          // autoIndex is off (connect.ts), so init() builds nothing: build explicitly, after the identity check.
          .then(() => model.createIndexes())
          .then(() => [])
          .catch((error: unknown) => [`${model.modelName}: index build failed — ${(error as Error).message}`])
      )
    )
  ).flat();

  const missing = [...buildFailures, ...(await Promise.all(models.map(findMissingIndexes))).flat()];

  if (missing.length > 0) {
    throw new Error(
      `Refusing to start: ${missing.length} declared index(es) are not in place.\n` +
        missing.map((entry) => `  - ${entry}`).join("\n") +
        `\n\nUniqueness constraints in this application are enforced by these indexes and by ` +
        `nothing else — idempotency, customer phone/email, SKU uniqueness, variantKey uniqueness, ` +
        `and order-number allocation all read a duplicate-key error as their control flow. ` +
        `Serving requests without them produces duplicate orders, duplicate accounts, and duplicate ` +
        `variants silently.`
    );
  }
}

/** Declared indexes with no counterpart in the database, described for the error. */
async function findMissingIndexes(model: Model<never>): Promise<string[]> {
  const built = await model.collection.indexes().catch(() => []);

  return model.schema.indexes().flatMap(([keys, options]) => {
    const declaredKey = JSON.stringify(keys);
    const match = built.find((index) => JSON.stringify(index.key) === declaredKey);

    if (!match) return [`${model.modelName}: no index on ${declaredKey}`];

    /*
     * An index that exists but is not unique is worse than one that is
     * missing: it satisfies a existence check while enforcing nothing. Worth
     * naming separately so the error says which of the two happened.
     */
    if (options?.unique && !match.unique) {
      return [`${model.modelName}: index on ${declaredKey} exists but is NOT unique`];
    }

    return [];
  });
}
