import { createPostRoute } from "../../../../../server/core/route-factories";
import { sweepOrphanImages } from "../../../../../server/admin/media/sweep-orphan-images";
import { CustomPermission } from "../../../../../common/authorization/authorization-registry";

/**
 * POST /api/admin/media/sweep-orphans — "Clean up unused images", run by staff from the bulk import page. Nothing runs
 * it on a schedule.
 *
 * Runs the existing orphan sweep unchanged: uploads recorded in `PendingUpload` that are older than 24 hours and that no
 * document references (`isImageReferenced`) are destroyed; referenced or younger ones are never touched; only this
 * application's media namespace is ever destroyed. At most one batch (oldest first) per call — pressing again continues.
 *
 * Held by `Catalog.publish`: deleting stored catalog media is a catalog-wide action. Idempotent (a destroyed or
 * referenced upload leaves the pending list), so it takes no `Idempotency-Key`, and it declares no `revalidateTags` —
 * an unused image is, by definition, shown nowhere.
 */
export const POST = createPostRoute({
  auth: { permissions: [CustomPermission.CATALOG_PUBLISH] },
  successStatus: 200,
  handler: async () => sweepOrphanImages(new Date()),
});
