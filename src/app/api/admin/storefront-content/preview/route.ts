import { createGetRoute } from "../../../../../server/core/route-factories";
import { previewStorefrontContentDraft } from "../../../../../server/admin/storefront-content/storefront-content";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

/**
 * The draft resolved exactly as `GET /api/storefront/content` would serve
 * it if published now, plus what would block publishing, by field. The
 * `draftRevision` it returns is what `PUT .../publish` must send back.
 */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.STOREFRONT_CONTENT.READ] },
  handler: async () => previewStorefrontContentDraft(new Date()),
});
