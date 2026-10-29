import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ADMIN_ROOT = join(__dirname);
const HTTP_EXPORT_PATTERN = /export const (GET|POST|PUT|PATCH|DELETE)\s*=/g;

/**
 * Every genuinely public admin action goes here, by exact file path relative
 * to `src/app/api/admin`, with the reason it needs no permission check.
 * `keeps the exemption list honest` below asserts every entry still exists
 * on disk, so a route rename doesn't leave a stale, unenforced exemption.
 */
const NO_PERMISSION_EXEMPT: Record<string, string> = {
  "auth/login/route.ts": "Public by necessity: this is how a staff member obtains a session. Rate limited by IP and account.",
  "auth/token/refresh/route.ts": "Public by necessity: the access token may have expired; the refresh-token cookie is the credential.",
  "auth/token/logout/route.ts": "Public by necessity: logging out must work with an expired access token; it only revokes what it is handed.",
  "auth/accept-invite/route.ts": "Public by necessity: the invitee has no account yet; the invitation token is the credential. Rate limited by IP.",
  "auth/me/route.ts": "Requires a session (`auth: true`) but no permission: every staff member may read their own identity.",
};

/**
 * Removes `//` and block comments while leaving string/template literals
 * intact (so `"https://x"` survives). Matching against raw source text lets a
 * guard call that only exists inside a comment satisfy the sweep.
 */
function stripComments(source: string): string {
  return source.replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match, literal: string | undefined) => (literal ? match : " ")
  );
}

/** Index of the bracket matching the opener at `open`, or -1. */
function matchClose(text: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === openCh) depth += 1;
    else if (ch === closeCh && --depth === 0) return i;
  }
  return -1;
}

/** An element counts only if it is not blank and not an empty string literal. */
function meaningfulElements(list: string): string[] {
  return list
    .split(",")
    .map((element) => element.trim())
    .filter((element) => element.length > 0 && !/^(""|''|``)$/.test(element));
}

/**
 * Pure per-file check, so the negative tests below can feed it synthetic
 * sources. Returns the problems found; an empty array means the file passes.
 * Comments are stripped first, and `auth: { ... }` blocks are brace-matched
 * (a regex like `[^}]*` truncates at the first nested object).
 */
export function checkAdminRouteSource(rawSource: string, relativePath: string): string[] {
  const source = stripComments(rawSource);
  const problems: string[] = [];

  const exportedHandlers = [...source.matchAll(HTTP_EXPORT_PATTERN)].map((match) => match[1]);
  if (exportedHandlers.length === 0) problems.push(`${relativePath}: exports no HTTP handler`);

  if (NO_PERMISSION_EXEMPT[relativePath]) return problems;

  const blocks: string[] = [];
  for (const match of source.matchAll(/auth:\s*\{/g)) {
    const open = match.index! + match[0].length - 1;
    const close = matchClose(source, open, "{", "}");
    blocks.push(source.slice(open, close === -1 ? undefined : close + 1));
  }
  if (blocks.length < exportedHandlers.length) {
    problems.push(`${relativePath}: ${blocks.length} auth block(s) for ${exportedHandlers.length} handler(s)`);
  }

  for (const block of blocks) {
    // Only a `permissions` key at the block's own depth counts, not one in a nested object.
    let depth = 0;
    let found = -1;
    for (let i = 0; i < block.length && found === -1; i += 1) {
      if (block[i] === "{") depth += 1;
      else if (block[i] === "}") depth -= 1;
      else if (depth === 1 && /^permissions\s*:\s*\[/.test(block.slice(i)) && !/[\w$]/.test(block[i - 1] ?? "")) found = i;
    }
    if (found === -1) {
      problems.push(`${relativePath}: auth block has no permissions array`);
      continue;
    }
    const open = block.indexOf("[", found);
    const close = matchClose(block, open, "[", "]");
    const elements = close === -1 ? [] : meaningfulElements(block.slice(open + 1, close));
    if (elements.length === 0) problems.push(`${relativePath}: permissions array is empty`);
  }
  return problems;
}

function findRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry.endsWith(".test.ts")) return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return findRouteFiles(full);
    return entry === "route.ts" ? [full] : [];
  });
}

/**
 * Static source-text analysis, not runtime introspection — the route
 * factory wraps every handler, so `auth` is not readable off the exported
 * function at runtime. This is deliberately **stricter** than the
 * restaurant precedent, which only checks for the presence of an `auth: {`
 * block: `auth: { permissions: [] }` would pass that check. Phase 4's own
 * spec calls this out by name as "not worth inheriting" — this test asserts
 * a genuinely non-empty `permissions` array.
 */
describe("every /api/admin route declares a non-empty permissions array", () => {
  const routeFiles = findRouteFiles(ADMIN_ROOT);

  it("found at least one admin route to check", () => {
    // A coverage test with nothing to cover proves nothing — this fails
    // loudly if the admin surface is ever accidentally emptied.
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it.each(routeFiles)("%s", (file) => {
    const relativePath = file.slice(ADMIN_ROOT.length + 1);
    expect(checkAdminRouteSource(readFileSync(file, "utf8"), relativePath)).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    const existing = new Set(routeFiles.map((file) => file.slice(ADMIN_ROOT.length + 1)));
    for (const exemptPath of Object.keys(NO_PERMISSION_EXEMPT)) {
      expect(existing.has(exemptPath), `exempted path no longer exists: ${exemptPath}`).toBe(true);
    }
  });
});

/**
 * "A test that cannot fail proves nothing": each case is a route the sweep
 * must REJECT. If the check is weakened, these go red.
 */
describe("checkAdminRouteSource rejects unguarded routes", () => {
  const route = (auth: string) => `export const GET = createGetRoute({ ${auth}, handler: async () => 1 });`;

  it("accepts a real permission", () => {
    expect(checkAdminRouteSource(route("auth: { permissions: [PERMISSIONS.orders.read] }"), "x/route.ts")).toEqual([]);
  });

  it("accepts a nested object before permissions", () => {
    const source = route("auth: { meta: { a: 1 }, permissions: [PERMISSIONS.orders.read] }");
    expect(checkAdminRouteSource(source, "x/route.ts")).toEqual([]);
  });

  it.each([
    ["permissions: []", "auth: { permissions: [] }"],
    ['permissions: [""]', 'auth: { permissions: [""] }'],
    ["permissions: [ /* none */ ]", "auth: { permissions: [ /* none */ ] }"],
    ["permissions: [ // none\n ]", "auth: { permissions: [ // none\n ] }"],
    ["no permissions key", "auth: { }"],
    ["auth: true", "auth: true"],
  ])("rejects %s", (_label, auth) => {
    expect(checkAdminRouteSource(route(auth), "x/route.ts")).not.toEqual([]);
  });

  it("rejects an empty permissions array hiding after a nested object (regex truncation case)", () => {
    const source = route("auth: { meta: { a: 1 }, permissions: [] }");
    expect(checkAdminRouteSource(source, "x/route.ts").join()).toMatch(/empty/);
  });

  it("does not let a nested object's permissions satisfy the outer block", () => {
    const source = route("auth: { meta: { permissions: [PERMISSIONS.orders.read] }, permissions: [] }");
    expect(checkAdminRouteSource(source, "x/route.ts")).not.toEqual([]);
  });

  it("rejects a route whose only auth block is commented out", () => {
    const source = "export const GET = createGetRoute({ /* auth: { permissions: [P.a] } */ handler: async () => 1 });";
    expect(checkAdminRouteSource(source, "x/route.ts")).not.toEqual([]);
  });
});

/**
 * A route handler's return value IS the response body — the route factory
 * serializes it as-is and takes the status from the method's default or
 * `successStatus`. A handler returning a `{ status, body }` envelope ships
 * that envelope to the client (a DELETE answering `200 {"status":204}`), which
 * is what every admin route did until this guard existed.
 */
describe("no /api/admin handler returns a { status, body } envelope", () => {
  it.each(findRouteFiles(ADMIN_ROOT))("%s", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/return\s*\{\s*status\s*:/);
  });
});
