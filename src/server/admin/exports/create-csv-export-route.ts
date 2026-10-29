import type { NextRequest } from "next/server";
import { createGetRoute } from "../../core/route-factories";
import { recordActivity } from "../../core/activity/record-activity";
import { csvStream, type CsvExport } from "./csv";

type RouteContext = { params: Promise<Record<string, string>> };

interface Captured {
  query: unknown;
  user: { _id?: unknown; name?: string; email?: string } | null | undefined;
}
const CAPTURED = new WeakMap<Request, Captured>();

/**
 * A GET route that answers with a streamed CSV instead of JSON.
 *
 * The toolkit's route factory can only answer JSON, so this wraps it rather than
 * replacing it: the factory still does everything that matters — authentication,
 * `auth.permissions` (every permission when `permissionMode: "all"`), query
 * validation, and error mapping (a 401/403/400 is the factory's own response and is
 * returned untouched). Only after all of that passed does the handler's captured
 * context build the file. (A raw-response route type belongs in
 * `@kira-joo/backend-toolkit-next`; this is the app-local bridge until it exists.)
 *
 * **Audited.** Downloading every order or every customer is a privileged act, and
 * the factory audits only mutations, so a successful export writes an activity entry
 * (the first permission's `Entity.action`, the filters used — never any row).
 */
export function createCsvExportRoute<TQuery extends object>(options: {
  auth: { permissions: readonly string[]; permissionMode?: "any" | "all" };
  query: new () => TQuery;
  build: (query: TQuery) => CsvExport | Promise<CsvExport>;
}) {
  const guarded = createGetRoute({
    auth: options.auth as never,
    query: options.query as never,
    handler: async ({ query, user, request }: { query: unknown; user: Captured["user"]; request: Request }) => {
      CAPTURED.set(request, { query, user });
      return { ok: true };
    },
  } as never) as unknown as (request: NextRequest, context: RouteContext) => Promise<Response>;

  return async (request: NextRequest, context: RouteContext): Promise<Response> => {
    const response = await guarded(request, context);
    const captured = CAPTURED.get(request);
    CAPTURED.delete(request);
    if (!captured) return response; // refused or invalid: the factory already built the right answer

    const file = await options.build(captured.query as TQuery);
    await recordActivity({
      permissionKey: options.auth.permissions[0]!,
      user: captured.user,
      body: filtersOf(captured.query),
      request,
    });

    const filename = `${file.filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csvStream(file.header, file.rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}

/** The query as plain filters for the audit entry — paging and sort keys are noise. */
function filtersOf(query: unknown): Record<string, unknown> {
  const { page: _page, limit: _limit, sortBy: _sortBy, sortOrder: _sortOrder, ...filters } = (query ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined));
}
