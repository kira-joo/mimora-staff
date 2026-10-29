import type { NextRequest } from "next/server";
import mongoose from "mongoose";
import { CustomPermission } from "../../../common/authorization/authorization-registry";
import { activityLogRepository } from "../repositories";
import { resolveClientIp } from "../rate-limit/enforce-rate-limit";
import { redact } from "./redact";

/**
 * Writes one audit entry, and never fails the request that caused it.
 *
 * ## Why this exists
 *
 * Found during the pre-implementation architecture review:
 * `restaurant-platform-staff`'s `ActivityLog` had a schema, a registered
 * model, four indexes, a read route, a UI screen and a nav item — and
 * **zero writers** for months, root-caused to one route using `.create()`
 * (instantiate-only, never persists) where every other call site used
 * `.save()`. Measured on a real database: 0 documents after 18 admin
 * mutations in one session — indistinguishable from "nothing has happened
 * yet," which is exactly why nobody noticed. This module and
 * `route-factories.ts`'s wrapping of it exist specifically so that class of
 * failure is structurally impossible here: a route cannot ship without
 * activity logging by forgetting to call it, because it never calls it —
 * the wrapper does.
 *
 * ## Why at the route-factory layer, not per-route
 *
 * The alternative is a call in each mutating route, and the ones that get
 * forgotten are the ones nobody is thinking about — which are exactly the
 * ones an audit trail exists for. One seam means a new route is audited the
 * day it is written, not the day someone remembers to add it.
 *
 * ## What it records
 *
 * `entityType`/`action` come from the route's own permission key
 * (`"Product.delete"` → `entityType="Product"`, `action="delete"`), so they
 * cannot drift from what the route actually authorises. `after` is the
 * request body with sensitive fields redacted. `before` is left absent —
 * this layer runs after the handler and cannot read prior state that no
 * longer exists; a route that has that state to hand may extend the entry
 * itself in a future phase.
 *
 * ## Failure is loud, not silent
 *
 * A failed audit write must not fail the mutation it is auditing, so it is
 * caught — but a swallowed catch here would recreate the exact defect this
 * module exists to prevent in a subtler form, so it is logged at error
 * level with the entry it failed to write.
 */
function toObjectId(value: unknown): mongoose.Types.ObjectId | undefined {
  if (typeof value !== "string" || !mongoose.isValidObjectId(value)) return undefined;
  return new mongoose.Types.ObjectId(value);
}

/**
 * The caller's address for the audit entry — resolved by the same trust model the rate limiter uses
 * (`resolveClientIp`: only what a trusted proxy appended is believed, `CLIENT_IP_TRUSTED_HOPS`,
 * `TRUST_X_REAL_IP`). This used to take the FIRST `x-forwarded-for` entry, which is whatever the caller chose to send,
 * so an audit row could carry an address the actor made up. `"unknown"` (no usable header) is stored as absent.
 */
function clientIp(request: NextRequest): string | undefined {
  const address = resolveClientIp(request);
  return address === "unknown" ? undefined : address;
}

export interface ActivitySubject {
  /** The record's entity, e.g. `"Return"`. */
  entityType: string;
}

const SUBJECTS = new WeakMap<object, ActivitySubject>();

/**
 * Names the record an audit entry is about, when it isn't the route
 * permission's own entity. `entityType` normally comes from the permission
 * key, but one permission can guard routes on different records:
 * `Payment.refund` guards both `/orders/:id/payment/refund` (an order) and
 * `/returns/:id/refund` (a return), so their entries were indistinguishable
 * and the `:id` could be either. The return route marks its result as a
 * `Return`; the action (`refund`) and the authorising permission are
 * unchanged, and the response is untouched — the mark lives here, not on
 * the object.
 */
export function auditSubject<T extends object>(result: T, subject: ActivitySubject): T {
  SUBJECTS.set(result, subject);
  return result;
}

const REPLAYS = new WeakSet<object>();

/**
 * Marks a result as the stored response of an idempotent replay. The route factory's audit wrapper skips a marked
 * result: a replay performs no mutation, so a second entry would claim a second refund (or verification, or status
 * change) that never happened and make one action look like two in the trail. The first request's entry is the record;
 * the mark lives here, not on the object, so the response is untouched. Only `runIdempotentMutation` applies it.
 */
export function markIdempotentReplay<T extends object>(result: T): T {
  REPLAYS.add(result);
  return result;
}

export interface ActivityEntryInput {
  /** The route's permission key, e.g. `"Product.delete"` or `"Payment.verify"` — always `Entity.action` per `createAuthorizationRegistry`'s own convention, including this app's `CustomPermission` entries. */
  permissionKey: string;
  user?: { _id?: unknown; name?: string; email?: string } | null;
  params?: Record<string, unknown>;
  body?: unknown;
  result?: unknown;
  request: NextRequest;
}

/**
 * Permissions whose mutations are not business events. Marking a notification
 * read changes only the caller's own read state — an audit row per click would
 * bury the trail the log exists to keep. A deliberate, named exception: every
 * other mutating route is still audited without being asked.
 */
const UNAUDITED_PERMISSIONS: ReadonlySet<string> = new Set([CustomPermission.NOTIFICATION_READ]);

export async function recordActivity(entry: ActivityEntryInput): Promise<void> {
  if (UNAUDITED_PERMISSIONS.has(entry.permissionKey)) return;
  if (entry.result !== null && typeof entry.result === "object" && REPLAYS.has(entry.result)) return;
  const [permissionEntity, ...actionParts] = entry.permissionKey.split(".");
  const subject = entry.result !== null && typeof entry.result === "object" ? SUBJECTS.get(entry.result) : undefined;
  const entityType = subject?.entityType ?? permissionEntity;
  const action = actionParts.join(".") || entry.permissionKey;

  const entityId = toObjectId(entry.params?.id) ?? toObjectId((entry.result as { _id?: unknown } | undefined)?._id?.toString?.());
  const actorId = toObjectId(entry.user?._id?.toString?.());

  if (!actorId) {
    // No resolvable staff actor — an unauthenticated or misconfigured route
    // reaching this wrapper at all is itself worth knowing about loudly,
    // not silently attributing the entry to nobody.
    console.error(`[activity] no actor for ${entry.permissionKey} — entry not recorded.`);
    return;
  }

  try {
    await activityLogRepository.save({
      actorId,
      action,
      entityType: entityType ?? entry.permissionKey,
      entityId,
      changes: entry.body === undefined ? undefined : (redact(entry.body) as Record<string, unknown>),
      ipAddress: clientIp(entry.request),
    });
  } catch (error) {
    console.error(`[activity] failed to record ${entry.permissionKey}${entityId ? ` on ${entityId.toString()}` : ""}:`, error);
  }
}
