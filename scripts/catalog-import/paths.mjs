import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the importer looks for a batch — always relative to the importer itself (this folder), never to the shell's
 * working directory, so the command behaves the same wherever it is run from.
 */
export const IMPORTER_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The batch folder that lives with the importer: scripts/catalog-import/product-import/ (catalog.json + its images). */
export const DEFAULT_IMPORT_DIR = path.join(IMPORTER_DIR, "product-import");

/** `--dir`: an absolute path is used as given; a relative one is taken from the importer's folder, like the default. */
export function resolveImportDir(dir) {
  if (dir === undefined) return DEFAULT_IMPORT_DIR;
  return path.isAbsolute(dir) ? path.normalize(dir) : path.resolve(IMPORTER_DIR, dir);
}
