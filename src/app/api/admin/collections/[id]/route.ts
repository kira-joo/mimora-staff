import { createGetRoute, createPutRoute, createDeleteRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdateCollectionDto } from "../../../../../server/admin/dto/update-collection.dto";
import { updateCollection } from "../../../../../server/admin/collections/update-collection";
import { collectionRepository } from "../../../../../server/core/repositories";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.COLLECTION.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    const collection = await collectionRepository.findOne({ where: { _id: params.id } });
    return collection;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.COLLECTION.UPDATE] },
  params: MongoIdParamsDto,
  body: UpdateCollectionDto,
  revalidateTags: ["COLLECTIONS"],
  handler: async ({ params, body }) => {
    const collection = await updateCollection(params.id, {
      name: body.name,
      description: body.description,
      slug: body.slug,
      sortOrder: body.sortOrder,
      image: body.image,
      icon: body.icon,
      seoTitle: body.seoTitle,
      seoDescription: body.seoDescription,
      published: body.published,
    });

    return collection;
  },
});

export const DELETE = createDeleteRoute({
  auth: { permissions: [AppPermission.COLLECTION.DELETE] },
  params: MongoIdParamsDto,
  revalidateTags: ["COLLECTIONS"],
  handler: async ({ params }) => {
    await collectionRepository.update({ where: { _id: params.id } }, { published: false });
    return;
  },
});
