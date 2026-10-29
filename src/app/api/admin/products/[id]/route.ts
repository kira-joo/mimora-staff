import { createGetRoute, createPutRoute, createDeleteRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdateProductDto } from "../../../../../server/admin/dto/update-product.dto";
import { updateProduct } from "../../../../../server/admin/products/update-product";
import { productRepository } from "../../../../../server/core/repositories";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PRODUCT.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    const product = await productRepository.findOne({ where: { _id: params.id } });
    return product;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.PRODUCT.UPDATE] },
  params: MongoIdParamsDto,
  body: UpdateProductDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ params, body }) => {
    const product = await updateProduct(params.id, {
      name: body.name,
      description: body.description,
      slug: body.slug,
      categoryId: body.categoryId,
      collectionIds: body.collectionIds,
      brandId: body.brandId,
      sizeGuide: body.sizeGuide,
      images: body.images,
      optionAxes: body.optionAxes,
      attributes: body.attributes,
      seoTitle: body.seoTitle,
      seoDescription: body.seoDescription,
      order: body.order,
      publishAt: body.publishAt ? new Date(body.publishAt) : undefined,
    });

    return product;
  },
});

export const DELETE = createDeleteRoute({
  auth: { permissions: [AppPermission.PRODUCT.DELETE] },
  params: MongoIdParamsDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ params }) => {
    await productRepository.update({ where: { _id: params.id } }, { lifecycle: "archived" });
    return;
  },
});
