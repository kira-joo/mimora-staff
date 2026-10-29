import { createGetRoute, createPutRoute } from "../../../../server/core/route-factories";
import { UpdateStoreProfileDto } from "../../../../server/admin/dto/update-store-profile.dto";
import { getSingletonSettings } from "../../../../server/admin/settings/singleton-settings";
import { storeProfileRepository } from "../../../../server/core/repositories";
import { updateStoreProfile } from "../../../../server/admin/store-profile/update-store-profile";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.STORE_PROFILE.READ] },
  handler: async () => {
    const profile = await getSingletonSettings(storeProfileRepository);
    return profile;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.STORE_PROFILE.UPDATE] },
  body: UpdateStoreProfileDto,
  revalidateTags: ["STORE_PROFILE"],
  handler: async ({ body }) => updateStoreProfile(body),
});
