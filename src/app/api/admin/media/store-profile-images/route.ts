import { BadRequestError } from "@kira-joo/backend-toolkit-core";
import { createPostRoute } from "../../../../../server/core/route-factories";
import { STORE_PROFILE_SLOTS, isStoreProfileSlot, storeProfileMediaSpec } from "../../../../../server/admin/media/media-targets";
import { uploadPublicImage } from "../../../../../server/admin/media/upload-public-image";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

/**
 * POST — upload one PUBLIC store-identity image (logo, favicon, OG image, hero) and answer the stored
 * `ImageAsset`. Multipart: field `file` plus field `slot`, which picks the policy the file is held to.
 * Nothing is written to the database here; the caller saves the asset through `PUT /api/admin/store-profile`.
 */
export const POST = createPostRoute({
  auth: { permissions: [AppPermission.STORE_PROFILE.UPDATE] },
  successStatus: 201,
  handler: async ({ request }) =>
    uploadPublicImage(request, (fields) => {
      if (!isStoreProfileSlot(fields.slot)) throw new BadRequestError(`"slot" must be one of: ${STORE_PROFILE_SLOTS.join(", ")}.`);
      return storeProfileMediaSpec(fields.slot);
    }),
});
