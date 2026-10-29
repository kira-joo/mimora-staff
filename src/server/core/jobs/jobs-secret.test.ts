import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { JOBS_SECRET_HEADER, jobsSecretMatches, jobsSecretStatus, requireJobsSecret } from "./jobs-secret";

const request = (headers: Record<string, string> = {}) => new NextRequest("http://localhost/api/internal/jobs/x", { method: "POST", headers });
const SECRET = "a-long-random-jobs-secret-value";

describe("jobsSecretMatches", () => {
  it("accepts only the exact secret", () => {
    expect(jobsSecretMatches(SECRET, SECRET)).toBe(true);
    expect(jobsSecretMatches(SECRET, `${SECRET}x`)).toBe(false);
    expect(jobsSecretMatches(SECRET, SECRET.slice(0, -1))).toBe(false);
    expect(jobsSecretMatches(SECRET, "")).toBe(false);
    expect(jobsSecretMatches(SECRET, undefined)).toBe(false);
  });

  it("never matches when no secret is configured — even an empty or undefined one presented back", () => {
    expect(jobsSecretMatches(undefined, undefined)).toBe(false);
    expect(jobsSecretMatches(undefined, "anything")).toBe(false);
    expect(jobsSecretMatches("", "")).toBe(false);
  });
});

describe("requireJobsSecret", () => {
  const env = { JOBS_SECRET: SECRET };

  it("passes for the secret in x-jobs-secret", () => {
    expect(() => requireJobsSecret(request({ [JOBS_SECRET_HEADER]: SECRET }), env)).not.toThrow();
  });

  it("passes for the secret as a Bearer token (what Vercel Cron sends)", () => {
    expect(() => requireJobsSecret(request({ authorization: `Bearer ${SECRET}` }), env)).not.toThrow();
  });

  it("passes for CRON_SECRET (Vercel's name) as a Bearer token or header, with no JOBS_SECRET set", () => {
    expect(() => requireJobsSecret(request({ authorization: `Bearer ${SECRET}` }), { CRON_SECRET: SECRET })).not.toThrow();
    expect(() => requireJobsSecret(request({ [JOBS_SECRET_HEADER]: SECRET }), { CRON_SECRET: SECRET })).not.toThrow();
  });

  it("when both are set, either one passes and a third value does not", () => {
    const both = { JOBS_SECRET: SECRET, CRON_SECRET: `${SECRET}-cron` };
    expect(() => requireJobsSecret(request({ authorization: `Bearer ${SECRET}` }), both)).not.toThrow();
    expect(() => requireJobsSecret(request({ authorization: `Bearer ${SECRET}-cron` }), both)).not.toThrow();
    expect(() => requireJobsSecret(request({ authorization: `Bearer ${SECRET}-other` }), both)).toThrow(NotFoundError);
  });

  it.each([
    ["no credential", {}],
    ["a wrong x-jobs-secret", { [JOBS_SECRET_HEADER]: "nope" }],
    ["a wrong bearer", { authorization: "Bearer nope" }],
    ["a non-bearer authorization", { authorization: `Basic ${SECRET}` }],
  ])("answers 404 (not 401/403) for %s", (_label, headers) => {
    expect(() => requireJobsSecret(request(headers), env)).toThrow(NotFoundError);
  });

  it("answers 404 for EVERYONE when JOBS_SECRET is unset — a presented value cannot match nothing", () => {
    expect(() => requireJobsSecret(request({ [JOBS_SECRET_HEADER]: SECRET }), {})).toThrow(NotFoundError);
    expect(() => requireJobsSecret(request({ [JOBS_SECRET_HEADER]: "" }), { JOBS_SECRET: "" })).toThrow(NotFoundError);
  });
});

describe("jobsSecretStatus — the boot announcement", () => {
  it("says 'scheduled jobs OFF' and names the variable (never a value) when unset", () => {
    const status = jobsSecretStatus({});
    expect(status.state).toBe("unconfigured");
    expect(status.message).toContain("JOBS_SECRET");
    expect(status.message).toContain("scheduled jobs OFF");
  });

  it("is configured by CRON_SECRET alone", () => {
    expect(jobsSecretStatus({ CRON_SECRET: SECRET }).state).toBe("configured");
  });

  it("is quiet-configured when set, and never echoes the secret", () => {
    const status = jobsSecretStatus({ JOBS_SECRET: SECRET });
    expect(status.state).toBe("configured");
    expect(status.message).not.toContain(SECRET);
  });
});
