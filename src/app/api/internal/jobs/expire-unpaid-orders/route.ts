import type { NextRequest } from "next/server";
import { createGetRoute, createPostRoute } from "../../../../../server/core/route-factories";
import { requireJobsSecret } from "../../../../../server/core/jobs/jobs-secret";
import { expireUnpaidOrders } from "../../../../../server/admin/orders/expire-unpaid-orders";

/**
 * /api/internal/jobs/expire-unpaid-orders — the scheduler's entry point for the unpaid-order sweep.
 *
 * `auth: false` because a scheduler has no staff session; the handler authenticates instead, with the shared
 * secret (`JOBS_SECRET` or `CRON_SECRET`; constant-time, 404 when unset or wrong — see `jobs-secret.ts`). It is
 * deliberately NOT under `/api/admin`, which is the staff surface and carries a permission on every route.
 *
 * **Two methods, one handler.** `POST` is the honest verb for a sweep that changes state, and what a plain `curl` in
 * cron or a Kubernetes CronJob should call. `GET` exists because Vercel Cron can only issue GET requests; it is not
 * an invitation to call this from a browser — it answers 404 to anyone without the secret, exactly like POST, and a
 * browser cannot attach the Bearer header on a plain navigation.
 *
 * Idempotent by construction, so a scheduler that fires twice, or overlaps itself, is harmless: a cancelled order
 * no longer matches the sweep. Hence no `Idempotency-Key`.
 */
const sweep = async ({ request }: { request: NextRequest }) => {
  requireJobsSecret(request);
  return expireUnpaidOrders(new Date());
};

/** Each cancelled order released its stock, so the listing rollups changed; a sweep that cancelled nothing changed nothing. */
const tagsFor = ({ result }: { result: { cancelled: string[] } }) => (result.cancelled.length > 0 ? ["PRODUCTS"] : []);

export const POST = createPostRoute({ auth: false, successStatus: 200, revalidateTags: tagsFor, handler: sweep });
export const GET = createGetRoute({ auth: false, revalidateTags: tagsFor, handler: sweep });

export const dynamic = "force-dynamic";
