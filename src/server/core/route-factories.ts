import {
  createDeleteRoute as createDeleteRouteBase,
  createGetRoute as createGetRouteBase,
  createPostRoute as createPostRouteBase,
  createPutRoute as createPutRouteBase,
} from "@kira-joo/backend-toolkit-next";
/*
 * Side-effect import, and it must stay first: it configures the toolkit in
 * this module graph. Turbopack gives instrumentation.ts its own bundle, so
 * the configuration done there is invisible to route handlers.
 */
import "./ensure-configured";
import { recordActivity } from "./activity/record-activity";

/**
 * **`idempotent: true` is refused here, unconditionally.** The
 * Phase 4A.5→4B verification pass found that the toolkit's own
 * `idempotent: true` reads the raw `Idempotency-Key` header directly inside
 * `create-route.ts` and keys the claim on that value alone — no actor, no
 * route beyond what `hashRequest` folds in for conflict detection. Every
 * mutation in this application that needs idempotency is either
 * money-moving, stock-moving, or customer-scoped, so there is no route in
 * this app for which the toolkit's un-scoped key is actually safe — using
 * it anywhere would be exactly the "raw globally-unique client key is a
 * cross-user replay hazard" this repo's own `CLAUDE.md` non-negotiable #8
 * warns against. Rather than trust every future route author to remember
 * that documentation, `idempotent: true` throws here at call time (route
 * modules are evaluated at build/boot, so this surfaces immediately, not on
 * a request in production) — the same "make the mistake structurally
 * impossible" choice this module already makes for activity logging.
 *
 * **Use `core/idempotency/scoped-idempotency.ts` instead**:
 * `claimIdempotentMutation()`/`completeIdempotentMutation()`/
 * `releaseIdempotentMutation()`, called explicitly inside the handler after
 * the actor is resolved. Same underlying `mongoIdempotencyStore`, same
 * `hashRequest`/error taxonomy — scoped by route+actor+client key before
 * the store is ever touched, which is the one thing `idempotent: true`
 * cannot do.
 */
function assertNotToolkitIdempotent<TOptions extends { idempotent?: boolean }>(options: TOptions): TOptions {
  if (options.idempotent) {
    throw new Error(
      "`idempotent: true` is disabled in this application — the toolkit keys it on the raw client header " +
        "alone, with no actor scoping. Use claimIdempotentMutation()/completeIdempotentMutation()/" +
        "releaseIdempotentMutation() from `core/idempotency/scoped-idempotency.ts` inside the handler instead."
    );
  }
  return options;
}

/**
 * The single place every route file imports its factory from — never
 * `@kira-joo/backend-toolkit-next` directly. That is what makes the
 * `./ensure-configured` side-effect import (which the toolkit's config
 * genuinely depends on — see that module's own comment) unconditional: a
 * route file cannot get a working factory without also getting the
 * configuration, because it is the same import. It is also what makes
 * automatic activity logging (below) unconditional for the same reason —
 * see `record-activity.ts`'s doc comment for why that matters.
 */

/**
 * Appends an audit entry after a successful mutation. Applied here, not in
 * each route, for the reason `record-activity.ts` gives at length: the
 * routes that would be forgotten are the ones an audit trail exists for.
 *
 * Reads are not audited — a GET that logged a row per request would bury
 * the trail in noise. Only routes that declare `auth.permissions` are
 * audited, because the permission key is where `entityType`/`action` come
 * from — a mutating route with no permission is either public (the shop
 * surface, which declares `auth: false` and is out of scope for this
 * staff-actor audit trail) or a bug, and neither should quietly produce an
 * entry attributed to nobody.
 *
 * The write is awaited, not fired-and-forgotten — a serverless invocation
 * ending before an unawaited write lands is exactly how a trail loses rows
 * under load, and a trail that loses rows silently is the same class of
 * defect this module exists to prevent.
 */
function auditingOptions<
  TOptions extends {
    handler: (context: never) => Promise<unknown>;
    auth?: { permissions?: readonly string[] } | boolean;
  },
>(options: TOptions): TOptions {
  const auth = options.auth;
  const permissionKey = typeof auth === "object" && auth !== null ? auth.permissions?.[0] : undefined;

  if (!permissionKey) return options;

  const inner = options.handler as (context: unknown) => Promise<unknown>;

  return {
    ...options,
    handler: async (context: unknown) => {
      const result = await inner(context);
      const ctx = context as {
        user?: { _id?: unknown; name?: string; email?: string } | null;
        params?: Record<string, unknown>;
        body?: unknown;
        request: Parameters<typeof recordActivity>[0]["request"];
      };

      await recordActivity({
        permissionKey,
        user: ctx.user,
        params: ctx.params,
        body: ctx.body,
        result,
        request: ctx.request,
      });

      return result;
    },
  } as TOptions;
}

export const createGetRoute: typeof createGetRouteBase = createGetRouteBase;

export const createPostRoute: typeof createPostRouteBase = (options) =>
  createPostRouteBase(assertNotToolkitIdempotent(auditingOptions(options)));

export const createPutRoute: typeof createPutRouteBase = (options) =>
  createPutRouteBase(assertNotToolkitIdempotent(auditingOptions(options)));

export const createDeleteRoute: typeof createDeleteRouteBase = (options) =>
  createDeleteRouteBase(assertNotToolkitIdempotent(auditingOptions(options)));
