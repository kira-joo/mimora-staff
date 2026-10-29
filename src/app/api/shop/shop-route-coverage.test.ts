import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SHOP_ROOT = join(__dirname);
const HTTP_EXPORT_PATTERN = /export const (GET|POST|PUT|PATCH|DELETE)\s*=/g;

/**
 * `auth: false` means two different things on two surfaces (Phase 4 spec),
 * and the difference between "public by design" and "requires a customer"
 * is carried by nothing but a function call inside the handler body. This
 * test is the thing that makes an omitted call a build failure instead of a
 * silently-public route — this workspace's restaurant precedent has three
 * guards on its admin surface and **none** on its shop surface, which is
 * exactly the gap this test exists to close before it repeats here.
 *
 * Static source-text analysis, not runtime introspection — see the sibling
 * admin coverage test for why.
 */
const NO_ACTOR_EXEMPT: Record<string, string> = {
  "auth/login/route.ts": "Creates the session — no actor exists yet to resolve.",
  "auth/signup/route.ts": "Creates the session — no actor exists yet to resolve.",
  "auth/refresh/route.ts": "The access token may already be expired; only a raw refresh cookie is read.",
  "auth/logout/route.ts": "Must succeed even with an expired/missing access token; only a raw refresh cookie is read.",
  "auth/forgot-password/route.ts": "Pre-session by definition — identifies a customer by submitted phone/email, not a session.",
  "auth/reset-password/route.ts": "Pre-session by definition — the presented reset token is the credential.",
  "auth/verify-email/route.ts": "Pre-session by definition — the presented verification token is the credential.",
  "auth/resend-verification/route.ts": "Pre-session by definition — identifies a customer by submitted email, not a session.",
  "newsletter/confirm/route.ts": "A subscriber is usually a guest — the presented confirmation token is the credential.",
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

/**
 * Pure per-file check, so the negative tests below can feed it synthetic
 * sources. Returns the problems found; an empty array means the file passes.
 */
export function checkShopRouteSource(rawSource: string, relativePath: string): string[] {
  const source = stripComments(rawSource);
  const problems: string[] = [];

  const exportedHandlers = [...source.matchAll(HTTP_EXPORT_PATTERN)].map((match) => match[1]);
  if (exportedHandlers.length === 0) problems.push(`${relativePath}: exports no HTTP handler`);

  // Every exported handler must declare auth: false — a shop route using
  // the toolkit's own auth mechanism would authenticate against
  // StaffUser, the exact cross-audience failure this surface exists to
  // avoid.
  const authFalseCount = (source.match(/auth:\s*false/g) ?? []).length;
  if (authFalseCount < exportedHandlers.length) {
    problems.push(`${relativePath}: every export must declare auth: false`);
  }

  if (NO_ACTOR_EXEMPT[relativePath]) return problems;

  const callsActor = /\b(requireCustomer|resolveShopActor|resolveOrderAccess)\s*\(/.test(source);
  if (!callsActor) {
    problems.push(
      `${relativePath}: calls none of requireCustomer(), resolveShopActor() or resolveOrderAccess() — ` +
        "either add one or add a named, justified entry to NO_ACTOR_EXEMPT"
    );
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

describe("every /api/shop route resolves an actor", () => {
  const routeFiles = findRouteFiles(SHOP_ROOT);

  it("found at least one shop route to check", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  it.each(routeFiles)("%s", (file) => {
    const relativePath = file.slice(SHOP_ROOT.length + 1);
    expect(checkShopRouteSource(readFileSync(file, "utf8"), relativePath)).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    const existing = new Set(routeFiles.map((file) => file.slice(SHOP_ROOT.length + 1)));
    for (const exemptPath of Object.keys(NO_ACTOR_EXEMPT)) {
      expect(existing.has(exemptPath), `exempted path no longer exists: ${exemptPath}`).toBe(true);
    }
  });
});

/**
 * "A test that cannot fail proves nothing": each case is a route the sweep
 * must REJECT. If the check is weakened, these go red.
 */
describe("checkShopRouteSource rejects unsafe routes", () => {
  const handler = (extra: string) =>
    `export const POST = createPostRoute({ auth: false, handler: async () => { ${extra} } });`;

  it("accepts a route that calls requireCustomer", () => {
    expect(checkShopRouteSource(handler("await requireCustomer();"), "cart/route.ts")).toEqual([]);
  });

  it("rejects auth:false with no actor call", () => {
    const problems = checkShopRouteSource(handler("return 1;"), "cart/route.ts");
    expect(problems.join()).toMatch(/calls none of/);
  });

  it("rejects an actor call that only appears in a line comment", () => {
    expect(checkShopRouteSource(handler("// await requireCustomer();"), "cart/route.ts")).not.toEqual([]);
  });

  it("rejects an actor call that only appears in a block comment", () => {
    expect(checkShopRouteSource(handler("/* resolveShopActor(req) */"), "cart/route.ts")).not.toEqual([]);
  });

  it("rejects a handler that does not declare auth: false", () => {
    const source = "export const GET = createGetRoute({ auth: true, handler: async () => { await requireCustomer(); } });";
    expect(checkShopRouteSource(source, "cart/route.ts").join()).toMatch(/auth: false/);
  });

  it("does not treat `//` inside a string literal as a comment", () => {
    expect(checkShopRouteSource(handler('const u = "https://x"; await requireCustomer();'), "cart/route.ts")).toEqual([]);
  });
});
