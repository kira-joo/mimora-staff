import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminPagesQueryDto } from "../../../../server/admin/dto/list-admin-pages-query.dto";
import { CreatePageDto } from "../../../../server/admin/dto/create-page.dto";
import { listPages } from "../../../../server/admin/pages/list-pages";
import { createPage } from "../../../../server/admin/pages/create-page";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PAGE.READ] },
  query: ListAdminPagesQueryDto,
  handler: async ({ query }) => {
    const result = await listPages(query);
    return result;
  },
});

export const POST = createPostRoute({
  auth: { permissions: [AppPermission.PAGE.CREATE] },
  body: CreatePageDto,
  revalidateTags: ["PAGES"],
  handler: async ({ body }) => {
    const page = await createPage({
      slug: body.slug,
      title: body.title,
      content: body.content,
      published: body.published,
      seo: body.seo,
    });

    return page;
  },
});
