import { createGetRoute, createPostRoute } from "../../../../../server/core/route-factories";
import { createMissingLegalPageDrafts, getLegalPagesOverview } from "../../../../../server/admin/pages/legal-page-drafts";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

/** Which of the seven legal pages are missing, unpublished or published — and whether the terms gate on orders is open. */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PAGE.READ] },
  handler: async () => getLegalPagesOverview(),
});

/**
 * "Create legal page drafts": adds every MISSING legal page as an UNPUBLISHED,
 * clearly marked draft. Never overwrites an existing page and never publishes,
 * so it declares no `revalidateTags` — customers cannot see an unpublished page,
 * and a call that created nothing has nothing to invalidate.
 */
export const POST = createPostRoute({
  auth: { permissions: [AppPermission.PAGE.CREATE] },
  handler: async () => createMissingLegalPageDrafts(),
});
