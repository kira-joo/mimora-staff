import { createPutRoute } from "../../../../../server/core/route-factories";
import { UpdateThemeDto } from "../../../../../server/admin/dto/update-theme.dto";
import { updateTheme } from "../../../../../server/admin/store-profile/update-theme";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

/**
 * Separate from `PUT /api/admin/store-profile` — `UpdateStoreProfileDto`
 * deliberately excludes `brand`/`theme` (see its own doc comment) so there
 * is exactly one write path for these fields, the one that runs contrast
 * measurement. Gated on the same `STORE_PROFILE.UPDATE` as the rest of the
 * document: this is a field group on an existing entity, not a distinct
 * action, so it doesn't warrant a `CustomPermission`.
 */
export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.STORE_PROFILE.UPDATE] },
  body: UpdateThemeDto,
  /**
   * `STORE_PROFILE` only — `GET /api/storefront/theme` declares its own
   * route as `force-dynamic` (`get-theme.ts`), so there is no ISR cache
   * entry for theme reads to invalidate. A `"THEME"` tag would be dead
   * weight nothing ever subscribes to.
   */
  revalidateTags: ["STORE_PROFILE"],
  handler: async ({ body }) => {
    const result = await updateTheme(body);
    return result;
  },
});
