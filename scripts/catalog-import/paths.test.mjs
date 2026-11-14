import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_IMPORT_DIR, IMPORTER_DIR, resolveImportDir } from "./paths.mjs";

const CLI = path.join(IMPORTER_DIR, "cli.mjs");
const PACKAGE_DIR = path.resolve(IMPORTER_DIR, "../..");

/**
 * Runs the real CLI from `cwd`. With an unreachable target (port 9 refuses at once) and dummy credentials it prints its
 * header — including the folder it resolved — and stops at sign-in: no store is contacted, nothing is read or written.
 */
function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, MIMORA_STAFF_URL: "", MIMORA_STAFF_EMAIL: "nobody@example.com", MIMORA_STAFF_PASSWORD: "unused" },
  });
  return `${result.stdout}${result.stderr}`;
}
const folderLine = (output) => output.split("\n").find((line) => line.trim().startsWith("folder:"))?.split("folder:")[1]?.trim();

describe("resolveImportDir", () => {
  it("defaults to the batch folder that lives with the importer", () => {
    expect(DEFAULT_IMPORT_DIR).toBe(path.join(IMPORTER_DIR, "product-import"));
    expect(resolveImportDir(undefined)).toBe(DEFAULT_IMPORT_DIR);
  });

  it("takes a relative --dir from the importer's folder, never from the shell's working directory", () => {
    expect(resolveImportDir("product-import")).toBe(DEFAULT_IMPORT_DIR);
    expect(resolveImportDir("batches/spring")).toBe(path.join(IMPORTER_DIR, "batches", "spring"));
  });

  it("uses an absolute --dir as given", () => {
    const absolute = path.join(os.tmpdir(), "some-batch");
    expect(resolveImportDir(absolute)).toBe(absolute);
  });
});

describe("the CLI resolves the same folder wherever it is run from", () => {
  it.each([
    ["an unrelated directory (the system temp folder)", os.tmpdir()],
    ["the filesystem root", path.parse(process.cwd()).root],
    ["the batch folder itself", DEFAULT_IMPORT_DIR],
  ])("from %s", (_label, cwd) => {
    const output = runCli(cwd, ["--dry-run", "--target", "http://127.0.0.1:9"]);
    expect(folderLine(output)).toBe(DEFAULT_IMPORT_DIR);
    expect(output).toContain("Error:"); // stopped at sign-in: the unreachable target was never imported into
  });

  it("a relative --dir from another directory is still taken from the importer's folder", () => {
    const output = runCli(os.tmpdir(), ["--dry-run", "--target", "http://127.0.0.1:9", "--dir", "product-import"]);
    expect(folderLine(output)).toBe(DEFAULT_IMPORT_DIR);
  });

  it("`npm run catalog:import` works from a subdirectory of mimora-staff (npm runs it from the package)", () => {
    const result = spawnSync("npm", ["run", "--silent", "catalog:import", "--", "--help"], { cwd: DEFAULT_IMPORT_DIR, encoding: "utf8", timeout: 30_000 });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`default: ${DEFAULT_IMPORT_DIR}`);
    expect(PACKAGE_DIR).toBe(path.resolve(DEFAULT_IMPORT_DIR, "../../.."));
  });
});
