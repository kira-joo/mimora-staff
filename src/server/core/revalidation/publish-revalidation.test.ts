import { afterEach, describe, expect, it, vi } from "vitest";
import { publishRevalidation, revalidationConfigStatus } from "./publish-revalidation";

const SECRET = "s3cr3t-value-that-must-never-leak";

describe("revalidationConfigStatus", () => {
  it("is unconfigured when both vars are unset", () => {
    const status = revalidationConfigStatus({});
    expect(status.state).toBe("unconfigured");
    expect(status.message).toMatch(/disabled/);
  });

  it("names the missing variable when half-configured (secret missing)", () => {
    const status = revalidationConfigStatus({ STOREFRONT_REVALIDATE_URL: "https://shop.example/api/revalidate" });
    expect(status.state).toBe("half-configured:REVALIDATE_SECRET");
    expect(status.message).toContain("REVALIDATE_SECRET");
  });

  it("names the missing variable when half-configured (url missing) and never echoes the secret", () => {
    const status = revalidationConfigStatus({ REVALIDATE_SECRET: SECRET });
    expect(status.state).toBe("half-configured:STOREFRONT_REVALIDATE_URL");
    expect(status.message).toContain("STOREFRONT_REVALIDATE_URL");
    expect(status.message).not.toContain(SECRET);
  });

  it("is configured when both are set, and the message never contains the secret", () => {
    const status = revalidationConfigStatus({
      STOREFRONT_REVALIDATE_URL: "https://shop.example/api/revalidate",
      REVALIDATE_SECRET: SECRET,
    });
    expect(status.state).toBe("configured");
    expect(status.message).not.toContain(SECRET);
  });
});

describe("publishRevalidation non-2xx errors", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function failWith(status: number) {
    vi.stubEnv("STOREFRONT_REVALIDATE_URL", "https://shop.example/api/revalidate?token=abc");
    vi.stubEnv("REVALIDATE_SECRET", SECRET);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status })));
    return publishRevalidation(["products"]).then(
      () => {
        throw new Error("expected rejection");
      },
      (error: Error) => error
    );
  }

  it("explains what a 404 means, names origin+path, and leaks neither secret nor query", async () => {
    const error = await failWith(404);
    expect(error.message).toContain("404");
    expect(error.message).toContain("REVALIDATE_SECRET differs between the two apps");
    expect(error.message).toContain("https://shop.example/api/revalidate");
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain("token=abc");
  });

  it("does not attach the 404 hint to other statuses", async () => {
    const error = await failWith(500);
    expect(error.message).toContain("500");
    expect(error.message).not.toContain("differs between the two apps");
  });
});
