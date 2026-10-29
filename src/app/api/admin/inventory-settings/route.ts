import { createGetRoute, createPutRoute } from "../../../../server/core/route-factories";
import { UpdateInventorySettingsDto } from "../../../../server/admin/dto/update-inventory-settings.dto";
import { getSingletonSettings, upsertSingletonSettings } from "../../../../server/admin/settings/singleton-settings";
import { inventorySettingsRepository } from "../../../../server/core/repositories";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.INVENTORY_SETTINGS.READ] },
  handler: async () => {
    const settings = await getSingletonSettings(inventorySettingsRepository);
    return settings;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.INVENTORY_SETTINGS.UPDATE] },
  /*
   * The low-stock threshold decides the "only a few left" signal on every listing card and on the product page,
   * and both are cached under PRODUCTS (listing reads and product-detail reads alike). Without this the
   * setting saves, returns 200, and the storefront keeps serving the old signal until the next unrelated
   * product change — the silent no-op the cache-invalidation rule exists to prevent.
   */
  revalidateTags: ["PRODUCTS"],
  body: UpdateInventorySettingsDto,
  handler: async ({ body }) => {
    const patch: Record<string, unknown> = {};
    if (body.lowStockThreshold !== undefined) patch.lowStockThreshold = body.lowStockThreshold;
    if (body.defaultInventoryPolicy !== undefined) patch.defaultInventoryPolicy = body.defaultInventoryPolicy;

    const settings = await upsertSingletonSettings(inventorySettingsRepository, patch);
    return settings;
  },
});
