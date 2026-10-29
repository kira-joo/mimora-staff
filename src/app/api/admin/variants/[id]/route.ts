import { toMoney } from "@kira-joo/toolkit-common";
import { createGetRoute, createPutRoute, createDeleteRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdateVariantDto } from "../../../../../server/admin/dto/update-variant.dto";
import { updateVariant } from "../../../../../server/admin/variants/update-variant";
import { deleteVariant } from "../../../../../server/admin/variants/delete-variant";
import { variantRepository } from "../../../../../server/core/repositories";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.VARIANT.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    const variant = await variantRepository.findOne({ where: { _id: params.id } });
    return variant;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.VARIANT.UPDATE] },
  params: MongoIdParamsDto,
  body: UpdateVariantDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ params, body }) => {
    const variant = await updateVariant(params.id, {
      sku: body.sku,
      optionValues: body.optionValues,
      price: body.price ? toMoney(body.price) : undefined,
      compareAtPrice: body.compareAtPrice ? toMoney(body.compareAtPrice) : undefined,
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
      discontinued: body.discontinued,
    });

    return variant;
  },
});

export const DELETE = createDeleteRoute({
  auth: { permissions: [AppPermission.VARIANT.DELETE] },
  params: MongoIdParamsDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ params }) => {
    await deleteVariant(params.id);
    return;
  },
});
