import type { PermissionDefinition } from "@kira-joo/backend-toolkit-core";
import type { AnyBulkWriteOperation, Model } from "mongoose";

/**
 * The fields of a stored permission that the code owns. `key` is the identity; `isActive`, `_id` and the timestamps
 * belong to the record (an operator can deactivate a permission), so an existing document's copies are never touched.
 */
const CANONICAL_FIELDS = ["entity", "action", "name", "isSystem"] as const;
type CanonicalField = (typeof CANONICAL_FIELDS)[number];
type StoredPermission = Partial<Record<CanonicalField, unknown>> & { key: string };

export interface ReconcilePermissionsResult {
  /** Keys inserted because no document had them. */
  created: string[];
  /** Keys whose stored canonical fields differed from the definition and were rewritten. */
  updated: string[];
  /** Keys already stored exactly as defined — not written at all. */
  skipped: string[];
}

const canonical = (definition: PermissionDefinition): Record<CanonicalField, unknown> => ({
  entity: definition.entity,
  action: definition.action,
  name: definition.name,
  // The schema's own default for a definition that does not say.
  isSystem: definition.isSystem ?? false,
});

/**
 * Makes the stored permissions match the code's definitions with the fewest writes: ONE read of every defined key,
 * then a write only for a key that is missing (inserted) or whose canonical fields drifted (`$set` of exactly those
 * fields). A routine boot, where everything already matches, writes nothing — so on a throughput-limited database a
 * cold start costs one operation here instead of one per permission.
 *
 * What it preserves, as the toolkit's insert-only `syncPermissions()` did:
 * - an existing document's `_id` (roles reference permissions by it), `isActive` and `createdAt`;
 * - permissions that are not in the definitions (never deleted).
 *
 * What it adds: drift in `entity`, `action`, `name` or `isSystem` is corrected, where the toolkit left it forever.
 *
 * Safe under concurrent cold starts: a missing key is written as an upsert keyed on the unique `key`, so two instances
 * inserting the same permission produce one document; a drift fix is a `$set` of fixed values, so repeating it is a
 * no-op. `Model.bulkWrite` applies the schema's timestamps (`createdAt` on insert, `updatedAt` on a real change).
 */
export async function reconcilePermissions<TDocument>({ model, definitions }: { model: Model<TDocument>; definitions: readonly PermissionDefinition[] }): Promise<ReconcilePermissionsResult> {
  const result: ReconcilePermissionsResult = { created: [], updated: [], skipped: [] };
  if (definitions.length === 0) return result;

  const projection = Object.fromEntries([["key", 1], ...CANONICAL_FIELDS.map((field) => [field, 1])]);
  const stored = (await model
    .find({ key: { $in: definitions.map((definition) => definition.key) } } as never, projection)
    // One round trip: MongoDB's default first batch stops at 101 documents, which would add a getMore.
    .batchSize(definitions.length + 1)
    .lean()) as unknown as StoredPermission[];
  const storedByKey = new Map(stored.map((document) => [document.key, document]));

  const operations: AnyBulkWriteOperation[] = [];
  for (const definition of definitions) {
    const wanted = canonical(definition);
    const existing = storedByKey.get(definition.key);
    if (!existing) {
      operations.push({ updateOne: { filter: { key: definition.key }, update: { $setOnInsert: { key: definition.key, ...wanted, isActive: true } }, upsert: true } });
      result.created.push(definition.key);
      continue;
    }
    const drift = Object.fromEntries(CANONICAL_FIELDS.filter((field) => existing[field] !== wanted[field]).map((field) => [field, wanted[field]]));
    if (Object.keys(drift).length === 0) {
      result.skipped.push(definition.key);
      continue;
    }
    operations.push({ updateOne: { filter: { key: definition.key }, update: { $set: drift } } });
    result.updated.push(definition.key);
  }

  if (operations.length > 0) await model.bulkWrite(operations as never, { ordered: false });
  return result;
}
