import { BadRequestError } from "@kira-joo/backend-toolkit-core";
import { parseMultipartFormData } from "@kira-joo/backend-toolkit-next";
import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminCatalogImportsQueryDto } from "../../../../server/admin/dto/list-admin-catalog-imports-query.dto";
import { listCatalogImports } from "../../../../server/admin/catalog-import/list-catalog-imports";
import { decodeCsvUpload, stageCatalogImport } from "../../../../server/admin/catalog-import/stage-catalog-import";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.CATALOG_IMPORT_BATCH.READ] },
  query: ListAdminCatalogImportsQueryDto,
  handler: async ({ query }) => listCatalogImports(query),
});

/** The multipart field a client submits the CSV under. */
const FILE_FIELD = "file";

/**
 * POST — stage a CSV. Multipart, field `file`. Validates every row and stores a `STAGED` batch with the per-row
 * errors and a summary; **nothing goes live and no `revalidateTags` is declared**, because nothing customers can
 * see has changed. Publishing is its own act (`PUT /:id/publish`, `Catalog.publish`).
 */
export const POST = createPostRoute({
  auth: { permissions: [AppPermission.CATALOG_IMPORT_BATCH.CREATE] },
  successStatus: 201,
  handler: async ({ request, user }) => {
    const { files } = await parseMultipartFormData(request);
    const file = files[FILE_FIELD];
    if (!file) throw new BadRequestError(`This route requires a "${FILE_FIELD}" file field holding the CSV.`);
    if (!/\.csv$/i.test(file.filename) && !["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"].includes(file.mimeType)) {
      throw new BadRequestError("Upload a .csv file.");
    }
    return stageCatalogImport({ content: decodeCsvUpload(file.buffer), filename: file.filename, stagedBy: user._id });
  },
});
