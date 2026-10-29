// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const configureToolkit = vi.fn();
const connectToDatabase = vi.fn();
vi.mock("./server/core/toolkit.config", () => ({ configureToolkit }));
vi.mock("./server/core/db/connect", () => ({ connectToDatabase }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("register() — production environment gate", () => {
  it("refuses to boot when required variables are missing, naming them and starting nothing", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    for (const name of ["MONGODB_URI", "MONGODB_DB", "STAFF_JWT_SECRET", "CUSTOMER_JWT_SECRET", "STORE_TIMEZONE"]) vi.stubEnv(name, "");

    const { register } = await import("./instrumentation");
    await expect(register()).rejects.toThrow(/STAFF_JWT_SECRET: is not set[\s\S]*STORE_TIMEZONE: is not set/);
    expect(configureToolkit).not.toHaveBeenCalled();
    expect(connectToDatabase).not.toHaveBeenCalled();
  });
});
