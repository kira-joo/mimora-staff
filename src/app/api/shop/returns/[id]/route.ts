import { createGetRoute } from "src/server/core/route-factories";
import { MongoIdParamsDto } from "src/server/catalog/dto/mongo-id-params.dto";
import { requireCustomer } from "src/server/shop/shop-actor";
import { getReturnDetail } from "src/server/shop/returns/get-return-detail";

/**
 * GET /api/shop/returns/[id] — full return detail.
 *
 * `[id]` is the `Return`'s own Mongo `_id`, not `returnNumber` — the
 * canonical MDS route names this segment `[id]`, unlike Orders' own
 * `[orderNumber]`, which is the signal that it's the document id here.
 */
export const GET = createGetRoute({
  auth: false,
  params: MongoIdParamsDto,
  handler: async ({ request, params }) => {
    const customer = await requireCustomer(request);

    return getReturnDetail({ customer, returnId: params.id });
  },
});

export const dynamic = "force-dynamic";
