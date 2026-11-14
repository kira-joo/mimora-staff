import { createGetRoute } from "../../../../server/core/route-factories";
import { loadAttributeCatalog } from "../../../../server/catalog/attribute-catalog-store";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

/**
 * The attributes products already use, derived (there is no attribute collection): one entry per key, with its usual name
 * and values. The product form picks from it so a new product reuses "Material" instead of typing a fifth spelling.
 */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PRODUCT.READ] },
  handler: async () => ({ data: await loadAttributeCatalog() }),
});
