// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const afterMock = vi.fn();
vi.mock("next/server", () => ({ after: afterMock }));

const { runAfterResponse, settleBackgroundWork } = await import("./after-response");

afterEach(() => {
  afterMock.mockReset();
  vi.restoreAllMocks();
});

describe("runAfterResponse", () => {
  it("in a request scope, hands the task to after() and does NOT run it inline", async () => {
    const task = vi.fn(async () => undefined);
    runAfterResponse("order email", task);
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(task).not.toHaveBeenCalled();

    // Next runs the callback once the response is sent.
    await afterMock.mock.calls[0]![0]();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("outside a request scope (after() throws) it runs a non-blocking promise: the caller is not held by a slow task", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope.");
    });
    let finished = false;
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      finished = true;
    };

    const started = Date.now();
    runAfterResponse("order email", slow);
    expect(Date.now() - started).toBeLessThan(100);
    expect(finished).toBe(false);

    await settleBackgroundWork();
    expect(finished).toBe(true);
  });

  it("a failing task is logged by error NAME only and never rejects — in either mode", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = async () => {
      const failure = new TypeError("could not reach smtp.secret-host.example as alice@example.com");
      throw failure;
    };

    runAfterResponse("order email ORDER_SHIPPED", failing); // request-scope path
    await expect(afterMock.mock.calls[0]![0]()).resolves.toBeUndefined();

    afterMock.mockImplementation(() => {
      throw new Error("outside");
    });
    runAfterResponse("order email ORDER_SHIPPED", failing); // fallback path
    await settleBackgroundWork();

    expect(error).toHaveBeenCalledTimes(2);
    for (const [line] of error.mock.calls) {
      expect(line).toBe("[notifications] order email ORDER_SHIPPED failed: TypeError");
      expect(String(line)).not.toContain("alice");
    }
  });
});
