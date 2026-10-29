import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminCategoriesQueryDto } from "../../../../server/admin/dto/list-admin-categories-query.dto";
import { CreateCategoryDto } from "../../../../server/admin/dto/create-category.dto";
import { listCategories } from "../../../../server/admin/categories/list-categories";
import { createCategory } from "../../../../server/admin/categories/create-category";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.CATEGORY.READ] },
  query: ListAdminCategoriesQueryDto,
  handler: async ({ query }) => {
    const result = await listCategories(query);
    return result;
  },
});

export const POST = createPostRoute({
  auth: { permissions: [AppPermission.CATEGORY.CREATE] },
  body: CreateCategoryDto,
  revalidateTags: ["CATEGORIES"],
  handler: async ({ body }) => {
    const category = await createCategory({
      name: body.name,
      description: body.description,
      slug: body.slug,
      parentId: body.parentId,
      sortOrder: body.sortOrder,
      image: body.image,
      seoTitle: body.seoTitle,
      seoDescription: body.seoDescription,
      published: body.published,
    });

    return category;
  },
});
