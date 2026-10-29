import { toMoney } from "@kira-joo/toolkit-common";
import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminVariantsQueryDto } from "../../../../server/admin/dto/list-admin-variants-query.dto";
import { CreateVariantDto } from "../../../../server/admin/dto/create-variant.dto";
import { listVariants } from "../../../../server/admin/variants/list-variants";
import { createVariant } from "../../../../server/admin/variants/create-variant";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.VARIANT.READ] },
  query: ListAdminVariantsQueryDto,
  handler: async ({ query }) => {
    const result = await listVariants(query);
    return result;
  },
});

export const POST = createPostRoute({
  auth: { permissions: [AppPermission.VARIANT.CREATE] },
  body: CreateVariantDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ body, user }) => {
    const variant = await createVariant({
      productId: body.productId,
      sku: body.sku,
      optionValues: body.optionValues,
      price: toMoney(body.price),
      compareAtPrice: body.compareAtPrice ? toMoney(body.compareAtPrice) : undefined,
      stock: body.stock,
      lowStockThreshold: body.lowStockThreshold,
      weight: body.weight,
      length: body.length,
      width: body.width,
      height: body.height,
      unitOfMeasure: body.unitOfMeasure,
      unitsPerSale: body.unitsPerSale,
      costPrice: body.costPrice ? toMoney(body.costPrice) : undefined,
      galleryOverride: body.galleryOverride,
      backorderPolicy: body.backorderPolicy,
      actorId: user._id,
    });

    return variant;
  },
});
