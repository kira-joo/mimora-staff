import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { storeProfileRepository } from "../core/repositories";
import type { StoreProfileSchema } from "../content/store-profile.schema";

/**
 * `StoreProfile` is a singleton per deployment (Phase 2 §8.1) — there is
 * exactly one document, never queried by id.
 */
export async function getStoreProfile(): Promise<StoreProfileSchema> {
  const profile = await storeProfileRepository.findOne({ where: {}, skipThrowError: true });
  if (!profile) throw new NotFoundError("Store profile is not configured.");
  return profile;
}
