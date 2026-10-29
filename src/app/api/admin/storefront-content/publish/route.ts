import { createPutRoute } from "../../../../../server/core/route-factories";
import { PublishStorefrontContentDto } from "../../../../../server/admin/dto/storefront-content.dto";
import { publishStorefrontContent } from "../../../../../server/admin/storefront-content/storefront-content";
import { CustomPermission } from "../../../../../common/authorization/authorization-registry";
import { CacheTag } from "../../../../../server/core/revalidation/cache-tag";

/**
 * Makes the previewed draft live. Its own permission — editing a draft does
 * not imply publishing it. The one write in this resource customers can
 * see, so the one that invalidates the storefront's `CONTENT` cache.
 */
export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.STOREFRONT_CONTENT_PUBLISH] },
  body: PublishStorefrontContentDto,
  revalidateTags: [CacheTag.CONTENT],
  handler: async ({ body, user }) => publishStorefrontContent(body.draftRevision, user._id, new Date()),
});
