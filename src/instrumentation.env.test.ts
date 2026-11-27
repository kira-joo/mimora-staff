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

describe("register() — a database failure at boot never poisons the instance", () => {
  // Next memoises register()'s promise for the life of the process: a rejection here would make every later request
  // fail ("An error occurred while loading instrumentation hook") even after the database recovers — the 2026-11-27
  // production incident. Requests run connectToDatabase() themselves, so boot must log and carry on.
  it("resolves, and logs the failure loudly, when the database is unreachable", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "development");
    connectToDatabase.mockRejectedValueOnce(new Error("Server selection timed out after 8000 ms"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const { register } = await import("./instrumentation");
    await expect(register()).resolves.toBeUndefined();

    expect(connectToDatabase).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[boot] database startup steps failed"), expect.objectContaining({ message: expect.stringContaining("Server selection timed out") }));
    error.mockRestore();
  });
});
