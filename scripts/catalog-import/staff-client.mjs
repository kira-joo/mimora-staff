/**
 * The catalog importer's only way into the store: the existing staff admin API, signed in as a staff member exactly
 * like the console (HttpOnly session + refresh cookies). No direct database access, no bypassed business logic.
 * Cookies live in memory only; credentials and cookies are never logged or written anywhere.
 */

/** Every admin path the importer uses — one place, never a path at a call site. Relative to `<target>/api/admin`. */
export const ENDPOINTS = {
  login: "/auth/login",
  refresh: "/auth/token/refresh",
  categories: "/categories",
  collections: "/collections",
  products: "/products",
  product: (id) => `/products/${encodeURIComponent(id)}`,
  productLifecycle: (id) => `/products/${encodeURIComponent(id)}/lifecycle`,
  variants: "/variants",
  productImages: "/media/product-images",
  productGroups: "/product-groups",
  productGroup: (id) => `/product-groups/${encodeURIComponent(id)}`,
  productGroupMembers: (id) => `/product-groups/${encodeURIComponent(id)}/members`,
};

const SESSION_COOKIE = "store_staff_session";
const REFRESH_COOKIE = "store_staff_refresh";
const PAGE_LIMIT = 100;

export class ImporterHttpError extends Error {
  constructor(method, path, status, message) {
    super(`${method} ${path} → ${status}${message ? `: ${message}` : ""}`);
    this.name = "ImporterHttpError";
    this.status = status;
  }
}

/**
 * @param {{ target: string, fetch?: typeof fetch, timeoutMs?: number }} options  `target` is the staff app's origin,
 *   e.g. "https://mimora-staff.vercel.app" or "http://localhost:3012".
 */
export function createStaffClient({ target, fetch: fetchImpl = globalThis.fetch, timeoutMs = 60_000 }) {
  const base = `${new URL(target).origin}/api/admin`;
  const cookies = new Map();
  let credentials = null;

  const cookieHeader = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  function absorb(response) {
    const list = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const line of list) {
      const [pair] = line.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!value || /max-age=0|expires=thu, 01 jan 1970/i.test(line)) cookies.delete(name);
      else cookies.set(name, value);
    }
  }

  async function raw(method, path, { json, form, auth = true } = {}) {
    const headers = {};
    if (auth && cookies.size > 0) headers.cookie = cookieHeader();
    if (json !== undefined) headers["content-type"] = "application/json";
    return fetchImpl(`${base}${path}`, { method, headers, body: json !== undefined ? JSON.stringify(json) : form, signal: AbortSignal.timeout(timeoutMs) });
  }

  async function errorOf(method, path, response) {
    let message = "";
    try {
      const body = await response.json();
      message = typeof body?.message === "string" ? body.message : Array.isArray(body?.errors) ? body.errors.map((e) => e.message ?? e).join("; ") : "";
    } catch {
      /* not JSON */
    }
    return new ImporterHttpError(method, path, response.status, message);
  }

  async function refreshSession() {
    if (cookies.has(REFRESH_COOKIE)) {
      const response = await fetchImpl(`${base}${ENDPOINTS.refresh}`, { method: "POST", headers: { cookie: `${REFRESH_COOKIE}=${cookies.get(REFRESH_COOKIE)}` }, signal: AbortSignal.timeout(timeoutMs) });
      absorb(response);
      if (response.ok) return true;
    }
    if (credentials) {
      await login(credentials.email, credentials.password);
      return true;
    }
    return false;
  }

  /** One authenticated request; a 401 refreshes the session (or signs in again) once and retries. */
  async function request(method, path, options = {}, retried = false) {
    const response = await raw(method, path, options);
    absorb(response);
    if (response.status === 401 && !retried && (await refreshSession())) return request(method, path, options, true);
    if (!response.ok) throw await errorOf(method, path, response);
    return response.status === 204 ? null : response.json();
  }

  async function login(email, password) {
    credentials = { email, password };
    const response = await raw("POST", ENDPOINTS.login, { json: { email, password }, auth: false });
    absorb(response);
    if (!response.ok) throw await errorOf("POST", ENDPOINTS.login, response);
    if (!cookies.has(SESSION_COOKIE)) throw new Error("Signed in, but the server set no session cookie.");
    return response.json().catch(() => null);
  }

  /** Every item of a paginated admin list. */
  async function listAll(path) {
    const items = [];
    for (let page = 1; ; page += 1) {
      const result = await request("GET", `${path}${path.includes("?") ? "&" : "?"}page=${page}&limit=${PAGE_LIMIT}`);
      items.push(...(result?.data ?? []));
      if (!result?.data?.length || result.data.length < PAGE_LIMIT || items.length >= (result.total ?? Infinity)) return items;
    }
  }

  return {
    origin: new URL(target).origin,
    login,
    /** Tests only: sign the client in with a session cookie minted by the test harness. */
    useSessionCookie(value) {
      cookies.set(SESSION_COOKIE, value);
    },
    get: (path) => request("GET", path),
    post: (path, json) => request("POST", path, { json }),
    put: (path, json) => request("PUT", path, { json }),
    listAll,
    /** Uploads one product image through the console's own upload route; answers the stored `ImageAsset`. */
    async uploadProductImage(buffer, filename, mime) {
      const form = new FormData();
      form.set("file", new Blob([buffer], { type: mime }), filename);
      return request("POST", ENDPOINTS.productImages, { form });
    },
    /** Is a previously uploaded image still there? Checked before re-using one from the state file. */
    async assetReachable(asset) {
      if (!asset?.secureUrl) return false;
      try {
        const response = await fetchImpl(asset.secureUrl, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
