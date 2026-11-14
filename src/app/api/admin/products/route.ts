import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminProductsQueryDto } from "../../../../server/admin/dto/list-admin-products-query.dto";
import { CreateProductDto } from "../../../../server/admin/dto/create-product.dto";
import { listProducts } from "../../../../server/admin/products/list-products";
import { createProduct } from "../../../../server/admin/products/create-product";
import { AppPermission } from "../../../../common/authorization/authorization-registry";
import { assertAttributeIdentity } from "../../../../server/catalog/attribute-catalog-store";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PRODUCT.READ] },
  query: ListAdminProductsQueryDto,
  handler: async ({ query }) => {
    const result = await listProducts(query);
    return result;
  },
});

export const POST = createPostRoute({
  auth: { permissions: [AppPermission.PRODUCT.CREATE] },
  body: CreateProductDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ body }) => {
    // A NEW attribute may not reuse an existing attribute's name (catalog import applies the same rule per row).
    if (body.attributes) await assertAttributeIdentity(body.attributes);
    const product = await createProduct({
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
      lifecycle: body.lifecycle,
      publishAt: body.publishAt ? new Date(body.publishAt) : undefined,
      order: body.order,
    }, { onSlugTaken: "suffix" });

    return product;
  },
});
