import { describe, expect, it } from "vitest";
import { createStaffClient } from "./staff-client.mjs";

/** A fake staff API: records calls; answers per route. */
function fakeServer(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const { pathname, search } = new URL(url);
    calls.push({ method: init.method, path: pathname + search, cookie: init.headers?.cookie, body: init.body });
    const handler = routes[`${init.method} ${pathname}`];
    if (!handler) return new Response(JSON.stringify({ message: "nope" }), { status: 404 });
    return handler({ url: new URL(url), init, calls });
  };
  return { fetch, calls };
}
const json = (body, status = 200, setCookies = []) => {
  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
};

describe("staff client", () => {
  it("signs in, then sends the session cookie on admin calls — and never the password", async () => {
    const server = fakeServer({
      "POST /api/admin/auth/login": () => json({ name: "Owner" }, 200, ["store_staff_session=s1; Path=/; HttpOnly", "store_staff_refresh=r1; Path=/api/admin/auth/token; HttpOnly"]),
      "GET /api/admin/categories": () => json({ data: [{ _id: "c1" }], total: 1 }),
    });
    const client = createStaffClient({ target: "https://store.example/some/path", fetch: server.fetch });
    await client.login("owner@example.com", "s3cret-password");
    await client.get("/categories");
    expect(server.calls[1]).toMatchObject({ path: "/api/admin/categories", cookie: "store_staff_session=s1; store_staff_refresh=r1" });
    expect(client.origin).toBe("https://store.example");
  });

  it("a wrong password is an error naming the status, without echoing credentials", async () => {
    const server = fakeServer({ "POST /api/admin/auth/login": () => json({ message: "Invalid email or password" }, 401) });
    const client = createStaffClient({ target: "https://store.example", fetch: server.fetch });
    const error = await client.login("owner@example.com", "s3cret-password").catch((e) => e);
    expect(error.message).toBe("POST /auth/login → 401: Invalid email or password");
    expect(error.message).not.toContain("s3cret");
  });

  it("an expired session is refreshed with the refresh cookie and the call retried once", async () => {
    let first = true;
    const server = fakeServer({
      "POST /api/admin/auth/login": () => json({}, 200, ["store_staff_session=old; Path=/", "store_staff_refresh=r1; Path=/api/admin/auth/token"]),
      "POST /api/admin/auth/token/refresh": () => json({}, 200, ["store_staff_session=new; Path=/", "store_staff_refresh=r2; Path=/api/admin/auth/token"]),
      "GET /api/admin/products": ({ init }) => {
        if (first) {
          first = false;
          return json({ message: "expired" }, 401);
        }
        return json({ data: [], total: 0, cookie: init.headers.cookie });
      },
    });
    const client = createStaffClient({ target: "https://store.example", fetch: server.fetch });
    await client.login("e", "p");
    const result = await client.get("/products");
    expect(result.cookie).toContain("store_staff_session=new");
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/admin/auth/login", "GET /api/admin/products", "POST /api/admin/auth/token/refresh", "GET /api/admin/products"]);
  });

  it("listAll pages through until the total is reached", async () => {
    const all = Array.from({ length: 230 }, (_, i) => ({ _id: `p${i}` }));
    const server = fakeServer({
      "POST /api/admin/auth/login": () => json({}, 200, ["store_staff_session=s; Path=/"]),
      "GET /api/admin/products": ({ url }) => {
        const page = Number(url.searchParams.get("page"));
        const limit = Number(url.searchParams.get("limit"));
        return json({ data: all.slice((page - 1) * limit, page * limit), total: all.length });
      },
    });
    const client = createStaffClient({ target: "https://store.example", fetch: server.fetch });
    await client.login("e", "p");
    expect((await client.listAll("/products")).length).toBe(230);
    expect(server.calls.filter((c) => c.path.startsWith("/api/admin/products")).map((c) => c.path)).toEqual(["/api/admin/products?page=1&limit=100", "/api/admin/products?page=2&limit=100", "/api/admin/products?page=3&limit=100"]);
  });

  it("uploads an image as multipart field 'file' to the console's upload route", async () => {
    const server = fakeServer({
      "POST /api/admin/auth/login": () => json({}, 200, ["store_staff_session=s; Path=/"]),
      "POST /api/admin/media/product-images": async ({ init }) => {
        const file = init.body.get("file");
        return json({ publicId: "mimora/store/products/x", bytes: file.size, name: file.name, type: file.type }, 201);
      },
    });
    const client = createStaffClient({ target: "https://store.example", fetch: server.fetch });
    await client.login("e", "p");
    expect(await client.uploadProductImage(Buffer.from("abc"), "a.jpeg", "image/jpeg")).toEqual({ publicId: "mimora/store/products/x", bytes: 3, name: "a.jpeg", type: "image/jpeg" });
  });
});
