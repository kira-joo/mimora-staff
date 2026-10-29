import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STOREFRONT_ROOT = join(__dirname);
const HTTP_EXPORT_PATTERN = /export const (GET|POST|PUT|PATCH|DELETE)\s*=/g;

function findRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry.endsWith(".test.ts")) return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return findRouteFiles(full);
    return entry === "route.ts" ? [full] : [];
  });
}

/**
 * "A missing second half is the silent half" (Phase 4 spec). `auth: false`
 * alone still lets Next attempt static generation against the route, which
 * fails the whole build the moment the database is unreachable at build
 * time (D-15's exact, reproduced failure mode) — `export const dynamic =
 * "force-dynamic"` is what prevents that attempt, and nothing else does.
 */
describe("every /api/storefront route is public AND force-dynamic", () => {
  const routeFiles = findRouteFiles(STOREFRONT_ROOT);

  it("found at least one storefront route to check", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it.each(routeFiles)("%s", (file) => {
    const source = readFileSync(file, "utf8");
    const relativePath = file.slice(STOREFRONT_ROOT.length + 1);

    const exportedHandlers = [...source.matchAll(HTTP_EXPORT_PATTERN)].map((match) => match[1]);
    expect(exportedHandlers.length).toBeGreaterThan(0);

    const authFalseCount = (source.match(/auth:\s*false/g) ?? []).length;
    expect(authFalseCount, `${relativePath}: every export must declare auth: false`).toBeGreaterThanOrEqual(
      exportedHandlers.length
    );

    expect(
      source.includes('export const dynamic = "force-dynamic"'),
      `${relativePath}: missing export const dynamic = "force-dynamic" — the silent half`
    ).toBe(true);
  });
});
