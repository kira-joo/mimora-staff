import type { NextRequest } from "next/server";
import { createGetRoute, createPostRoute } from "../../../../../server/core/route-factories";
import { requireJobsSecret } from "../../../../../server/core/jobs/jobs-secret";
import { sweepOrphanImages } from "../../../../../server/admin/media/sweep-orphan-images";

/**
 * /api/internal/jobs/sweep-orphan-images — the scheduler's entry point for the abandoned-upload sweep (daily).
 *
 * Same guard as `expire-unpaid-orders`: `auth: false` because a scheduler has no staff session, and the handler
 * authenticates with the shared secret (`JOBS_SECRET` or `CRON_SECRET`; constant-time, 404 when unset or wrong).
 * `POST` is the honest verb for a sweep that changes state; `GET` exists because Vercel Cron can only issue GET, and
 * answers 404 to anyone without the secret exactly like POST.
 *
 * Idempotent, so a scheduler that fires twice or overlaps itself is harmless, and it declares no `revalidateTags`: an
 * orphan is by definition referenced by nothing, so nothing the storefront shows can change.
 */
const sweep = async ({ request }: { request: NextRequest }) => {
  requireJobsSecret(request);
  return sweepOrphanImages(new Date());
};

export const POST = createPostRoute({ auth: false, successStatus: 200, handler: sweep });
export const GET = createGetRoute({ auth: false, handler: sweep });

export const dynamic = "force-dynamic";
