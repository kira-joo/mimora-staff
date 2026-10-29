import { createGetRoute, createPutRoute, createDeleteRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdateBrandDto } from "../../../../../server/admin/dto/update-brand.dto";
import { updateBrand } from "../../../../../server/admin/brands/update-brand";
import { brandRepository } from "../../../../../server/core/repositories";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.BRAND.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    const brand = await brandRepository.findOne({ where: { _id: params.id } });
    return brand;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.BRAND.UPDATE] },
  params: MongoIdParamsDto,
  body: UpdateBrandDto,
  revalidateTags: ["BRANDS"],
  handler: async ({ params, body }) => {
    const brand = await updateBrand(params.id, {
      name: body.name,
      slug: body.slug,
      description: body.description,
      published: body.published,
    });

    return brand;
  },
});

export const DELETE = createDeleteRoute({
  auth: { permissions: [AppPermission.BRAND.DELETE] },
  params: MongoIdParamsDto,
  revalidateTags: ["BRANDS"],
  handler: async ({ params }) => {
    await brandRepository.update({ where: { _id: params.id } }, { published: false });
    return;
  },
});
