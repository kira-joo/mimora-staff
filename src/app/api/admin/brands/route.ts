import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminBrandsQueryDto } from "../../../../server/admin/dto/list-admin-brands-query.dto";
import { CreateBrandDto } from "../../../../server/admin/dto/create-brand.dto";
import { listBrands } from "../../../../server/admin/brands/list-brands";
import { createBrand } from "../../../../server/admin/brands/create-brand";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.BRAND.READ] },
  query: ListAdminBrandsQueryDto,
  handler: async ({ query }) => {
    const result = await listBrands(query);
    return result;
  },
});

export const POST = createPostRoute({
  auth: { permissions: [AppPermission.BRAND.CREATE] },
  body: CreateBrandDto,
  revalidateTags: ["BRANDS"],
  handler: async ({ body }) => {
    const brand = await createBrand({
      name: body.name,
      slug: body.slug,
      description: body.description,
      published: body.published,
    });

    return brand;
  },
});
