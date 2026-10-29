import { toMoney } from "@kira-joo/toolkit-common";
import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminPromotionsQueryDto } from "../../../../server/admin/dto/list-admin-promotions-query.dto";
import { CreatePromotionDto } from "../../../../server/admin/dto/create-promotion.dto";
import { listPromotions } from "../../../../server/admin/promotions/list-promotions";
import { createPromotion } from "../../../../server/admin/promotions/create-promotion";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PROMOTION.READ] },
  query: ListAdminPromotionsQueryDto,
  handler: async ({ query }) => {
    const result = await listPromotions(query);
    return result;
  },
});

export const POST = createPostRoute({
  auth: { permissions: [AppPermission.PROMOTION.CREATE] },
  body: CreatePromotionDto,
  revalidateTags: ["PROMOTIONS"],
  handler: async ({ body }) => {
    const promotion = await createPromotion({
      code: body.code,
      name: body.name,
      description: body.description,
      type: body.type,
      value: body.value === undefined ? undefined : toMoney(body.value),
      conditions: {
        ...body.conditions,
        minSubtotal: body.conditions.minSubtotal ? toMoney(body.conditions.minSubtotal) : undefined,
        startsAt: body.conditions.startsAt ? new Date(body.conditions.startsAt) : undefined,
        endsAt: body.conditions.endsAt ? new Date(body.conditions.endsAt) : undefined,
      },
      limits: body.limits,
      stackable: body.stackable,
      active: body.active,
    });

    return promotion;
  },
});
