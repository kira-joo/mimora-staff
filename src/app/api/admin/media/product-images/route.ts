import { createPostRoute } from "../../../../../server/core/route-factories";
import { catalogMediaSpec } from "../../../../../server/admin/media/media-targets";
import { uploadPublicImage } from "../../../../../server/admin/media/upload-public-image";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

/**
 * POST — upload one PUBLIC product image, answer the stored `ImageAsset`. Multipart, field `file`.
 * Holding `PRODUCT.CREATE` or `PRODUCT.UPDATE` is enough: a new record has to be able to carry an image
 * before it exists. Nothing is written to the database here; the caller saves the returned asset on the record.
 */
export const POST = createPostRoute({
  auth: { permissions: [AppPermission.PRODUCT.CREATE, AppPermission.PRODUCT.UPDATE], permissionMode: "any" },
  successStatus: 201,
  handler: async ({ request }) => uploadPublicImage(request, () => catalogMediaSpec("product")),
});
