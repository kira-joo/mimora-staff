import { createPutRoute } from "../../../../../server/core/route-factories";
import { ReorderCollectionsDto } from "../../../../../server/admin/dto/reorder-collections.dto";
import { reorderCollections } from "../../../../../server/admin/collections/reorder-collections";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.COLLECTION.UPDATE] },
  successStatus: 204,
  body: ReorderCollectionsDto,
  revalidateTags: ["COLLECTIONS"],
  handler: async ({ body }) => {
    await reorderCollections({ items: body.items });
    return;
  },
});
