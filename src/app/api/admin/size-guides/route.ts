import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminSizeGuidesQueryDto } from "../../../../server/admin/dto/list-admin-size-guides-query.dto";
import { CreateSizeGuideDto } from "../../../../server/admin/dto/create-size-guide.dto";
import { sizeGuideRepository } from "../../../../server/core/repositories";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.SIZE_GUIDE.READ] },
  query: ListAdminSizeGuidesQueryDto,
  handler: async ({ query }) => {
    const result = await sizeGuideRepository.findAllAndCountPublic({ query });
    return result;
  },
});

export const POST = createPostRoute({
  auth: { permissions: [AppPermission.SIZE_GUIDE.CREATE] },
  body: CreateSizeGuideDto,
  revalidateTags: ["SIZE_GUIDES"],
  handler: async ({ body }) => {
    const sizeGuide = await sizeGuideRepository.save({
      name: body.name,
      description: body.description,
      chartData: body.chartData,
    });

    return sizeGuide;
  },
});
