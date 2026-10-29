import { createGetRoute } from "../../../../../server/core/route-factories";
import { BoardOrdersQueryDto } from "../../../../../server/admin/dto/board-orders-query.dto";
import { getOrdersBoard } from "../../../../../server/admin/orders/board-orders";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

/** The operations board: every working order, one column per status. Same permission as the list it is a view of. */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.ORDER.READ] },
  query: BoardOrdersQueryDto,
  handler: async ({ query }) => getOrdersBoard(query),
});
