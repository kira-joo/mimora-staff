import { createGetRoute, createPutRoute } from "../../../../server/core/route-factories";
import { SaveStorefrontContentDraftDto } from "../../../../server/admin/dto/storefront-content.dto";
import { getStorefrontContentAdmin, saveStorefrontContentDraft } from "../../../../server/admin/storefront-content/storefront-content";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

/** The storefront-content record as the console edits it: the draft, what is live, and whether they differ. */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.STOREFRONT_CONTENT.READ] },
  handler: async () => getStorefrontContentAdmin(),
});

/**
 * Replaces the draft. No `revalidateTags`: a draft is never public, so
 * saving one changes nothing a customer can see — only publishing does.
 */
export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.STOREFRONT_CONTENT.UPDATE] },
  body: SaveStorefrontContentDraftDto,
  handler: async ({ body }) => saveStorefrontContentDraft(body),
});
