import { createGetRoute, createPutRoute, createDeleteRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdatePageDto } from "../../../../../server/admin/dto/update-page.dto";
import { updatePage } from "../../../../../server/admin/pages/update-page";
import { pageRepository } from "../../../../../server/core/repositories";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PAGE.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    const page = await pageRepository.findOne({ where: { _id: params.id } });
    return page;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.PAGE.UPDATE] },
  params: MongoIdParamsDto,
  body: UpdatePageDto,
  revalidateTags: ["PAGES"],
  handler: async ({ params, body }) => {
    const page = await updatePage(params.id, {
      slug: body.slug,
      title: body.title,
      content: body.content,
      published: body.published,
      seo: body.seo,
    });

    return page;
  },
});

export const DELETE = createDeleteRoute({
  auth: { permissions: [AppPermission.PAGE.DELETE] },
  params: MongoIdParamsDto,
  revalidateTags: ["PAGES"],
  handler: async ({ params }) => {
    await pageRepository.update({ where: { _id: params.id } }, { published: false });
    return;
  },
});
