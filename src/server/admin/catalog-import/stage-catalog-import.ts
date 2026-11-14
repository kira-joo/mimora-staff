import { BadRequestError } from "@kira-joo/backend-toolkit-core";
import { catalogImportBatchRepository } from "../../core/repositories";
import type { CatalogImportBatchSchema } from "../../catalog/catalog-import-batch.schema";
import { loadCatalogSnapshot } from "./load-catalog-snapshot";
import { ImportFileError, parseCatalogCsv } from "./parse-catalog-csv";
import { planCatalogImport } from "./plan-catalog-import";
import { importAttributeIdentityErrors } from "./import-attribute-identity";
import { loadAttributeCatalog } from "../../catalog/attribute-catalog-store";
import { MAX_IMPORT_FILE_BYTES } from "./import-types";

/** Decodes as strict UTF-8. A Windows-1256 export is bytes that are not valid UTF-8; reading it leniently would turn every Arabic letter into U+FFFD and look like it worked. */
export function decodeCsvUpload(buffer: Buffer): string {
  if (buffer.length > MAX_IMPORT_FILE_BYTES) throw new BadRequestError(`The file is larger than ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)} MB. Split it into several files.`);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer);
  } catch {
    throw new BadRequestError('The file is not valid UTF-8, so Arabic text would be corrupted. In Excel choose "Save as" → "CSV UTF-8 (Comma delimited)".');
  }
}

/**
 * Reads a CSV, validates every row against the file and the catalog as it is now, and STAGES the result:
 * a `CatalogImportBatch` holding the parsed products, the per-row errors and warnings, and a summary of what publishing
 * would do. **Nothing live changes** — no product, variant, stock figure or movement is written, and no cache is
 * invalidated. A batch with row errors is still stored (so the preview can show them); it simply cannot be published.
 *
 * A file that cannot be read as a catalog at all (no header, a required column missing, an unclosed quote, over the
 * row cap, not UTF-8) is a 400 and no batch is stored — there is nothing to preview.
 */
export async function stageCatalogImport(input: { content: string; filename?: string; stagedBy: string }): Promise<CatalogImportBatchSchema> {
  let parsed;
  try {
    parsed = parseCatalogCsv(input.content);
  } catch (error) {
    if (error instanceof ImportFileError) throw new BadRequestError(error.message);
    throw error;
  }

  const plan = planCatalogImport(parsed.products, await loadCatalogSnapshot(parsed.products));
  // The same standardized-attribute rule as the product form: a new attribute may not duplicate an existing one's name.
  const identityErrors = importAttributeIdentityErrors(plan.products, await loadAttributeCatalog());
  const rowErrors = [...parsed.errors, ...plan.errors, ...identityErrors].sort((a, b) => a.row - b.row);
  const warnings = [...parsed.warnings, ...plan.warnings].sort((a, b) => a.row - b.row);

  return catalogImportBatchRepository.save({
    status: "STAGED",
    rows: parsed.products,
    rowErrors,
    warnings,
    filename: input.filename?.slice(0, 200),
    summary: { ...plan.summary, lines: parsed.lines, errors: rowErrors.length, warnings: warnings.length },
    stagedBy: input.stagedBy,
  });
}
