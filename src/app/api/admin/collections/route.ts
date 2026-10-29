import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminCollectionsQueryDto } from "../../../../server/admin/dto/list-admin-collections-query.dto";
import { CreateCollectionDto } from "../../../../server/admin/dto/create-collection.dto";
import { listCollections } from "../../../../server/admin/collections/list-collections";
import { createCollection } from "../../../../server/admin/collections/create-collection";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.COLLECTION.READ] },
  query: ListAdminCollectionsQueryDto,
  handler: async ({ query }) => {
    const result = await listCollections(query);
    return result;
  },
});

export const POST = createPostRoute({
  auth: { permissions: [AppPermission.COLLECTION.CREATE] },
  body: CreateCollectionDto,
  revalidateTags: ["COLLECTIONS"],
  handler: async ({ body }) => {
    const collection = await createCollection({
      name: body.name,
      description: body.description,
      slug: body.slug,
      sortOrder: body.sortOrder,
      image: body.image,
      seoTitle: body.seoTitle,
      seoDescription: body.seoDescription,
      published: body.published,
    });

    return collection;
  },
});
