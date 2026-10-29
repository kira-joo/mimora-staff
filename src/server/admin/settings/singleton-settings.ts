import type { DeepPartial, MongooseRepository } from "@kira-joo/backend-toolkit-mongoose";

/**
 * Shared read/write shape for every singleton config document (StoreProfile,
 * FulfilmentSettings, PaymentSettings, NotificationSettings, OperatingHours,
 * InventorySettings — all "singleton per deployment, same convention as
 * StoreProfile" per their own doc comments). A read never persists: before
 * the merchant has ever saved, an unsaved document's own applied schema
 * defaults are returned instead of writing one into existence.
 *
 * Read and write return the repository's own results; the toolkit serializes
 * a hydrated document's Money exactly like a lean read's, so both paths
 * answer the same JSON.
 */
export async function getSingletonSettings<T>(repository: MongooseRepository<T>): Promise<T> {
  const existing = await repository.findOne({ where: {}, skipThrowError: true });
  return existing ?? repository.create({} as DeepPartial<T>);
}

/**
 * Upserts the one document — `{}` matches the existing singleton if present,
 * or creates it on first save. `updateAtomic` returns the written document,
 * so there is no read-back.
 */
/** `unset` removes optional fields the merchant cleared (see `toUpdateOperators`). */
export async function upsertSingletonSettings<T>(repository: MongooseRepository<T>, patch: Record<string, unknown>, unset?: Record<string, "">): Promise<T> {
  return repository.updateAtomic({}, { $set: patch, ...(unset && Object.keys(unset).length ? { $unset: unset } : {}) }, { upsert: true });
}
