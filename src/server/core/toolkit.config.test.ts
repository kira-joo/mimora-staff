import { getNextBackendToolkitConfig, resetNextBackendToolkitConfig } from "@kira-joo/backend-toolkit-next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishRevalidation } from "./revalidation/publish-revalidation";
import { configureToolkit } from "./toolkit.config";

describe("configureToolkit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetNextBackendToolkitConfig();
  });

  it("wires cache.publishRevalidation to the app's publisher (a missing cache key silently disables invalidation)", () => {
    vi.stubEnv("STAFF_JWT_SECRET", "x".repeat(40));
    configureToolkit();
    const config = getNextBackendToolkitConfig();
    expect(config.cache?.publishRevalidation).toBe(publishRevalidation);
  });
});
