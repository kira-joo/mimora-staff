import { toMoney } from "@kira-joo/toolkit-common";
import { createGetRoute, createPutRoute, createDeleteRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdatePromotionDto } from "../../../../../server/admin/dto/update-promotion.dto";
import { mapPresent } from "../../../../../server/core/update/optional-update";
import { updatePromotion } from "../../../../../server/admin/promotions/update-promotion";
import { promotionRepository } from "../../../../../server/core/repositories";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PROMOTION.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    const promotion = await promotionRepository.findOne({ where: { _id: params.id } });
    return promotion;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.PROMOTION.UPDATE] },
  params: MongoIdParamsDto,
  body: UpdatePromotionDto,
  revalidateTags: ["PROMOTIONS"],
  handler: async ({ params, body }) => {
    // Omitted fields stay undefined and null stays null: `updatePromotion` reads omitted as "unchanged" and null as "clear".
    const promotion = await updatePromotion(params.id, {
      code: body.code,
      name: body.name,
      description: body.description,
      type: body.type,
      value: mapPresent(body.value, toMoney),
      conditions: body.conditions
        ? {
            ...body.conditions,
            minSubtotal: mapPresent(body.conditions.minSubtotal, toMoney),
            startsAt: mapPresent(body.conditions.startsAt, (iso) => new Date(iso)),
            endsAt: mapPresent(body.conditions.endsAt, (iso) => new Date(iso)),
          }
        : undefined,
      limits: body.limits,
      stackable: body.stackable,
      active: body.active,
    });

    return promotion;
  },
});

export const DELETE = createDeleteRoute({
  auth: { permissions: [AppPermission.PROMOTION.DELETE] },
  params: MongoIdParamsDto,
  revalidateTags: ["PROMOTIONS"],
  handler: async ({ params }) => {
    await promotionRepository.update({ where: { _id: params.id } }, { active: false });
    return;
  },
});
