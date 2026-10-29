import { createPutRoute } from "../../../../../server/core/route-factories";
import { ReorderCategoriesDto } from "../../../../../server/admin/dto/reorder-categories.dto";
import { reorderCategories } from "../../../../../server/admin/categories/reorder-categories";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.CATEGORY.UPDATE] },
  successStatus: 204,
  body: ReorderCategoriesDto,
  revalidateTags: ["CATEGORIES"],
  handler: async ({ body }) => {
    await reorderCategories({ items: body.items });
    return;
  },
});
