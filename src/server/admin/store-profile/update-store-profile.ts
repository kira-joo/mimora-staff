import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import type { StoreProfileSchema } from "../../content/store-profile.schema";
import { storeProfileRepository } from "../../core/repositories";
import { STORE_PROFILE_SLOTS } from "../media/media-targets";
import { destroyImagesOnCommit, removedPublicIds } from "../media/image-cleanup";
import { getSingletonSettings } from "../settings/singleton-settings";
import type { UpdateStoreProfileDto } from "../dto/update-store-profile.dto";

/**
 * `PUT /api/admin/store-profile` — a partial patch of the singleton.
 *
 * Absent keys stay as they are. A store-identity image set to `null` is removed (`$unset`), and one
 * replaced or removed has its stored asset destroyed once the write has committed — never inside the
 * transaction, never on a rollback.
 *
 * `defaultSeo` is merged field by field rather than replaced: it carries the page title and description
 * only. (An earlier `defaultSeo.ogImage` was never read by the storefront, which reads `ogImage`; it is
 * left untouched on documents that still hold one rather than silently deleted.)
 */
export async function updateStoreProfile(body: UpdateStoreProfileDto): Promise<StoreProfileSchema> {
  const before = await getSingletonSettings(storeProfileRepository);
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};

  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || key === "defaultSeo") continue;
    if (value === null) unset[key] = "";
    else set[key] = value;
  }

  if (body.defaultSeo) {
    for (const field of ["title", "description"] as const) {
      if (body.defaultSeo[field]) set[`defaultSeo.${field}`] = body.defaultSeo[field];
      else unset[`defaultSeo.${field}`] = "";
    }
  }

  return withTransaction(async (tx) => {
    const updated = await storeProfileRepository.updateAtomic({}, { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) }, { upsert: true });

    const removed = STORE_PROFILE_SLOTS.flatMap((slot) => removedPublicIds(before[slot], body[slot]));
    destroyImagesOnCommit(tx, removed);

    return tx.complete(updated);
  });
}
