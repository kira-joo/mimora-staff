import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Coverage sweep: every state-changing route under orders / payments / returns either runs through
 * `runIdempotentMutation` (claim the scoped `Idempotency-Key`, run once, replay on retry) or sits on a named,
 * justified exemption. Without it, a new money- or stock-moving admin route that forgets the wrapper is silently
 * non-idempotent and nothing says so — the same hazard the shop and permission sweeps exist for.
 */
const ADMIN_ROOT = join(__dirname, "..");
const SCOPES = ["orders", "payments", "returns"];
const WRITE_EXPORT = /export const (POST|PUT|PATCH|DELETE)\s*=/;

const EXEMPT: Record<string, string> = {
  "orders/expire-unpaid/route.ts": "Naturally idempotent: a cancelled order no longer matches the sweep, so a repeat cancels nothing further.",
  "returns/[id]/approve/route.ts": "A status decision that moves no money and no stock; the state machine refuses a repeat with a 409.",
  "returns/[id]/reject/route.ts": "A status decision that moves no money and no stock; the state machine refuses a repeat with a 409.",
};

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === "route.ts" ? [path] : [];
  });
}

const writeRoutes = SCOPES.flatMap((scope) => routeFiles(join(ADMIN_ROOT, scope)))
  .map((file) => ({ file, relative: file.slice(ADMIN_ROOT.length + 1) }))
  .filter(({ file }) => WRITE_EXPORT.test(readFileSync(file, "utf8")));

describe("every state-changing orders / payments / returns route is idempotent or justified", () => {
  it("found the write routes to check", () => {
    // A sweep with nothing to sweep proves nothing: the six money/stock routes are among them.
    expect(writeRoutes.length).toBeGreaterThanOrEqual(6);
  });

  it.each(writeRoutes.map(({ relative }) => relative))("%s", (relative) => {
    const source = readFileSync(join(ADMIN_ROOT, relative), "utf8");
    if (EXEMPT[relative]) return;
    expect(source, `${relative} moves money or stock and must use runIdempotentMutation`).toContain("runIdempotentMutation(");
  });

  it("keeps the exemption list honest", () => {
    const existing = new Set(writeRoutes.map(({ relative }) => relative));
    for (const exempt of Object.keys(EXEMPT)) expect(existing.has(exempt), `exempted route no longer exists: ${exempt}`).toBe(true);
  });

  it("an exempt route never also claims idempotency (the exemption would be stale)", () => {
    for (const exempt of Object.keys(EXEMPT)) expect(readFileSync(join(ADMIN_ROOT, exempt), "utf8")).not.toContain("runIdempotentMutation(");
  });
});
