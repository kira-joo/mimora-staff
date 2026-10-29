import { toMoney } from "@kira-joo/toolkit-common";
import { createPostRoute, createPutRoute } from "../../../../../server/core/route-factories";
import { BulkCreateVariantsDto, BulkUpdateVariantsDto } from "../../../../../server/admin/dto/bulk-variants.dto";
import { bulkCreateVariants } from "../../../../../server/admin/variants/bulk-create-variants";
import { bulkUpdateVariants } from "../../../../../server/admin/variants/bulk-update-variants";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

/**
 * POST — create the chosen combinations of a product's variant matrix, all or none, with opening stock.
 * Same permission as creating one variant.
 */
export const POST = createPostRoute({
  auth: { permissions: [AppPermission.VARIANT.CREATE] },
  body: BulkCreateVariantsDto,
  successStatus: 201,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ body, user }) =>
    bulkCreateVariants({
      productId: body.productId,
      actorId: user._id,
      rows: body.rows.map((row) => ({
        sku: row.sku,
        optionValues: row.optionValues,
        price: toMoney(row.price),
        compareAtPrice: row.compareAtPrice ? toMoney(row.compareAtPrice) : undefined,
        costPrice: row.costPrice ? toMoney(row.costPrice) : undefined,
        stock: row.stock,
      })),
    }),
});

/**
 * PUT — apply the matrix grid's inline edits (price, compare-at, cost, on/off sale), all or none.
 * Same permission as updating one variant. Stock is not editable here.
 */
export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.VARIANT.UPDATE] },
  body: BulkUpdateVariantsDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ body }) =>
    bulkUpdateVariants({
      productId: body.productId,
      rows: body.rows.map((row) => ({
        id: row.id,
        price: row.price ? toMoney(row.price) : undefined,
        compareAtPrice: row.compareAtPrice === null ? null : row.compareAtPrice ? toMoney(row.compareAtPrice) : undefined,
        costPrice: row.costPrice === null ? null : row.costPrice ? toMoney(row.costPrice) : undefined,
        discontinued: row.discontinued,
      })),
    }),
});
