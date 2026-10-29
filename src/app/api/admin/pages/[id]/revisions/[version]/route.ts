import { createGetRoute } from "../../../../../../../server/core/route-factories";
import { PageRevisionParamsDto } from "../../../../../../../server/admin/pages/page-revision-params.dto";
import { getPageRevision } from "../../../../../../../server/admin/pages/page-revision-history";
import { AppPermission } from "../../../../../../../common/authorization/authorization-registry";

/** The full text of one version — an order's "terms version N" resolves here. */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PAGE.READ_ONE] },
  params: PageRevisionParamsDto,
  handler: async ({ params }) => getPageRevision(params.id, params.version),
});
