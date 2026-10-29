import { createGetRoute, createPutRoute, createDeleteRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdateSizeGuideDto } from "../../../../../server/admin/dto/update-size-guide.dto";
import { sizeGuideRepository } from "../../../../../server/core/repositories";
import { deleteSizeGuide } from "../../../../../server/admin/size-guides/delete-size-guide";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.SIZE_GUIDE.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    const sizeGuide = await sizeGuideRepository.findOne({ where: { _id: params.id } });
    return sizeGuide;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.SIZE_GUIDE.UPDATE] },
  params: MongoIdParamsDto,
  body: UpdateSizeGuideDto,
  revalidateTags: ["SIZE_GUIDES"],
  handler: async ({ params, body }) => {
    const sizeGuide = await sizeGuideRepository.update({ where: { _id: params.id } }, body);
    return sizeGuide;
  },
});

export const DELETE = createDeleteRoute({
  auth: { permissions: [AppPermission.SIZE_GUIDE.DELETE] },
  params: MongoIdParamsDto,
  revalidateTags: ["SIZE_GUIDES"],
  handler: async ({ params }) => {
    await deleteSizeGuide(params.id);
    return;
  },
});
