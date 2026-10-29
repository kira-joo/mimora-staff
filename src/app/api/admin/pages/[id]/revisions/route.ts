import { createGetRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { listPageRevisions } from "../../../../../../server/admin/pages/page-revision-history";
import { AppPermission } from "../../../../../../common/authorization/authorization-registry";

/** Every version of one page, newest first — reading history is reading the page (D-13). */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PAGE.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => listPageRevisions(params.id),
});
