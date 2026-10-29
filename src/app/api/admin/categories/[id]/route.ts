import { createGetRoute, createPutRoute, createDeleteRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdateCategoryDto } from "../../../../../server/admin/dto/update-category.dto";
import { updateCategory } from "../../../../../server/admin/categories/update-category";
import { categoryRepository } from "../../../../../server/core/repositories";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.CATEGORY.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    const category = await categoryRepository.findOne({ where: { _id: params.id } });
    return category;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.CATEGORY.UPDATE] },
  params: MongoIdParamsDto,
  body: UpdateCategoryDto,
  revalidateTags: ["CATEGORIES"],
  handler: async ({ params, body }) => {
    const category = await updateCategory(params.id, {
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

export const DELETE = createDeleteRoute({
  auth: { permissions: [AppPermission.CATEGORY.DELETE] },
  params: MongoIdParamsDto,
  revalidateTags: ["CATEGORIES"],
  handler: async ({ params }) => {
    await categoryRepository.updateAtomic({ _id: params.id }, { $set: { published: false } });
    return;
  },
});
