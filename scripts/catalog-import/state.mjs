import fs from "node:fs";
import path from "node:path";

/**
 * What earlier `--execute` runs did, kept in the import folder so a re-run resumes instead of repeating:
 * uploaded images (by content hash → the stored ImageAsset), products this importer created (slug → id, variants,
 * whether its lifecycle was set, whether it is complete) and groups it created. Kept PER TARGET STORE, so one folder
 * imported into a local store and later into production never mixes the two.
 *
 * It is the importer's proof of ownership: only a product it created can be resumed; anything else is never touched.
 * Delete it only if you mean "this importer created nothing in that store".
 */
export const STATE_FILE = ".catalog-import-state.json";

const empty = () => ({ images: {}, products: {}, groups: {} });

export function loadState(dir, origin) {
  const file = path.join(dir, STATE_FILE);
  let all = { version: 1, targets: {} };
  if (fs.existsSync(file)) {
    try {
      all = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`${file} cannot be read (${error.message}). It is the record of what earlier runs created — restore it from a backup rather than deleting it; nothing was written.`);
    }
  }
  if (all.version !== 1 || typeof all.targets !== "object") throw new Error(`${file} is not a catalog import state file this version understands.`);
  const target = { ...empty(), ...(all.targets[origin] ?? {}) };
  return {
    target,
    /** Writes the whole file atomically (temp file + rename) — called after EVERY successful step. */
    save() {
      all.targets[origin] = target;
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(all, null, 2)}\n`);
      fs.renameSync(temporary, file);
    },
  };
}

export const LOCK_FILE = ".catalog-import.lock";

/**
 * One `--execute` at a time per import folder: two runs reading and writing the same state file would lose each
 * other's records (and could both create a group). Created exclusively; a second run is refused, not queued.
 * Released on exit; a lock left by a crashed run names its pid and start time so it can be removed by hand.
 */
export function acquireLock(dir) {
  const file = path.join(dir, LOCK_FILE);
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const holder = fs.readFileSync(file, "utf8");
    throw new Error(`Another import is running in this folder (${holder}). If that run is no longer alive, delete ${file} and run again.`);
  }
  return () => fs.rmSync(file, { force: true });
}
