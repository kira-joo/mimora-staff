import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENV_VAR_NAMES } from "./env-validation";

/**
 * The inventory test: every environment variable the source reads is declared in
 * `env-validation.ts`, and every declared variable is read somewhere.
 *
 * Without the first half a new `process.env.X` ships undocumented, unvalidated and
 * absent from `.env.example`; without the second a renamed variable leaves a dead
 * declaration instructing the next person to configure something with no effect.
 *
 * Test files are excluded: they assign their own fixtures (`T_DAYS`, `MONGODB_URI ??=`).
 * Recognised reads: `process.env.X`, `process.env["X"]`, a bare `env.X` / `env["X"]`
 * (the pure status functions take `env` as a parameter), and a name passed as a string
 * to `requireSecret` / `requireEnv`, which read it dynamically.
 */
const SRC = path.resolve(__dirname, "../../..");
const SKIP_DIRS = new Set(["node_modules", ".next"]);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) && !full.includes(`${path.sep}test-support${path.sep}`)) found.push(full);
  }
  return found;
}

const NAME = "[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*";
const READS = [
  new RegExp(`process\\.env\\.(${NAME})\\b`, "g"),
  new RegExp(`process\\.env\\[\\s*["'\`](${NAME})["'\`]\\s*\\]`, "g"),
  new RegExp(`(?<![\\w.])env\\.(${NAME})\\b`, "g"),
  new RegExp(`(?<![\\w.])env\\[\\s*["'\`](${NAME})["'\`]\\s*\\]`, "g"),
  new RegExp(`(?:requireSecret|requireEnv)\\(\\s*["'\`](${NAME})["'\`]`, "g"),
];

function variablesRead(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const pattern of READS) {
      for (const match of text.matchAll(pattern)) if (!found.has(match[1]!)) found.set(match[1]!, path.relative(SRC, file));
    }
  }
  return found;
}

describe("environment inventory", () => {
  it("finds the reads it is supposed to find (a scanner that matches nothing proves nothing)", () => {
    const read = variablesRead();
    for (const name of ["MONGODB_URI", "STAFF_JWT_SECRET", "CUSTOMER_JWT_SECRET", "STORE_TIMEZONE", "REVALIDATE_SECRET", "SMTP_HOST", "CLOUDINARY_API_KEY", "CLIENT_IP_TRUSTED_HOPS"]) {
      expect(read.has(name), name).toBe(true);
    }
  });

  it("every variable the source reads is declared in env-validation.ts", () => {
    const undeclared = [...variablesRead()].filter(([name]) => !ENV_VAR_NAMES.has(name)).map(([name, file]) => `${name} (read in ${file})`);
    expect(undeclared).toEqual([]);
  });

  it("every declared variable is read somewhere in the source", () => {
    const read = variablesRead();
    const allText = sourceFiles(SRC)
      .filter((file) => !file.endsWith("env-validation.ts"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    // Names handed to a reader as a bare string (mail and Cloudinary keep their variable lists as constants) count as read.
    const dead = [...ENV_VAR_NAMES].filter((name) => !read.has(name) && !new RegExp(`["'\`]${name}["'\`]`).test(allText));
    expect(dead).toEqual([]);
  });
});
