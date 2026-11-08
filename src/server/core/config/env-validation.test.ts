import { describe, expect, it } from "vitest";
import { ENV_VARS, EnvironmentConfigurationError, assertProductionEnvironment, isSecretVariable, validateEnvironment } from "./env-validation";

const STAFF = "s".repeat(40);
const CUSTOMER = "c".repeat(40);

/** The smallest environment a production process may start with. */
const REQUIRED = {
  MONGODB_URI: "mongodb+srv://user:pw@cluster.example.mongodb.net/?retryWrites=true",
  MONGODB_DB: "store-prod",
  STAFF_JWT_SECRET: STAFF,
  CUSTOMER_JWT_SECRET: CUSTOMER,
  STORE_ID: "hirfa",
  STORE_TIMEZONE: "Africa/Cairo",
};

const prod = (env: Record<string, string | undefined>) => validateEnvironment(env, { production: true });

describe("required variables", () => {
  it("a minimal valid production environment has no problems and no notices", () => {
    expect(prod(REQUIRED)).toEqual({ problems: [], notices: [] });
  });

  it.each(Object.keys(REQUIRED))("%s missing or blank is a problem that names it", (name) => {
    for (const value of [undefined, "", "   "]) {
      const { problems } = prod({ ...REQUIRED, [name]: value });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(name);
    }
  });

  it("rejects a short secret, and the unedited .env.example placeholder", () => {
    expect(prod({ ...REQUIRED, STAFF_JWT_SECRET: "short" }).problems[0]).toMatch(/STAFF_JWT_SECRET.*32 characters/);
    expect(prod({ ...REQUIRED, STAFF_JWT_SECRET: "replace-with-at-least-32-random-characters" }).problems[0]).toMatch(/placeholder/);
  });

  it("the two JWT secrets must differ", () => {
    const { problems } = prod({ ...REQUIRED, CUSTOMER_JWT_SECRET: STAFF });
    expect(problems).toEqual(["CUSTOMER_JWT_SECRET: must differ from STAFF_JWT_SECRET"]);
  });

  it("validates the store id as a lowercase slug", () => {
    for (const ok of ["mimora", "hirfa", "qahwa", "a", "store-1", "a".repeat(40)]) expect(prod({ ...REQUIRED, STORE_ID: ok }).problems).toEqual([]);
    for (const bad of ["Hirfa", "-hirfa", "hirfa-", "has space", "hir_fa", "a".repeat(41), "مطعم"]) {
      const { problems } = prod({ ...REQUIRED, STORE_ID: bad });
      expect(problems, bad).toHaveLength(1);
      expect(problems[0]).toMatch(/STORE_ID: must be/);
    }
  });

  it("validates the time zone through Intl", () => {
    expect(prod({ ...REQUIRED, STORE_TIMEZONE: "Africa/Cairo" }).problems).toEqual([]);
    expect(prod({ ...REQUIRED, STORE_TIMEZONE: "Mars/Olympus" }).problems[0]).toMatch(/STORE_TIMEZONE.*IANA/);
  });

  it("requires a mongodb URI and a plain database name", () => {
    expect(prod({ ...REQUIRED, MONGODB_URI: "postgres://x" }).problems[0]).toMatch(/MONGODB_URI/);
    expect(prod({ ...REQUIRED, MONGODB_DB: "has space" }).problems[0]).toMatch(/MONGODB_DB/);
  });

  it("warns, without failing, when a mongodb:// URI names no replica set", () => {
    const report = prod({ ...REQUIRED, MONGODB_URI: "mongodb://db.internal:27017/x" });
    expect(report.problems).toEqual([]);
    expect(report.notices[0]?.message).toMatch(/replicaSet/);
    expect(prod({ ...REQUIRED, MONGODB_URI: "mongodb://db.internal:27017/x?replicaSet=rs0" }).notices).toEqual([]);
  });
});

describe("capability variables are never fatal", () => {
  it("are silent when absent (their own modules announce OFF)", () => {
    expect(prod(REQUIRED).notices).toEqual([]);
  });

  it("a set-but-weak secret or a non-https URL in production is an error notice, not a problem", () => {
    const report = prod({ ...REQUIRED, REVALIDATE_SECRET: "weak", STOREFRONT_REVALIDATE_URL: "http://shop.example/api/revalidate" });
    expect(report.problems).toEqual([]);
    const text = report.notices.map((notice) => notice.message).join("\n");
    expect(text).toMatch(/REVALIDATE_SECRET must be at least 32/);
    expect(text).toMatch(/STOREFRONT_REVALIDATE_URL must be https in production/);
    expect(report.notices.every((notice) => notice.level === "error")).toBe(true);
  });

  it("in production, plain http is accepted only for a loopback origin (a local production run), never a real host", () => {
    expect(prod({ ...REQUIRED, STOREFRONT_REVALIDATE_URL: "http://localhost:3130/api/revalidate" }).notices).toEqual([]);
    const real = prod({ ...REQUIRED, STOREFRONT_REVALIDATE_URL: "http://localhost.example.com/api/revalidate" });
    expect(real.notices.map((notice) => notice.message).join("\n")).toMatch(/must be https in production/);
  });

  it("http is acceptable outside production", () => {
    expect(validateEnvironment({ ...REQUIRED, STOREFRONT_REVALIDATE_URL: "http://localhost:3030/api/revalidate" }, { production: false }).notices).toEqual([]);
  });

  it("rejects an origin that carries a path-less query, and a malformed phone code, TTL and hop count", () => {
    const report = prod({ ...REQUIRED, STOREFRONT_URL: "https://shop.example/?a=1", STORE_PHONE_COUNTRY_CODE: "+20", CUSTOMER_ACCESS_TOKEN_TTL: "soon", CLIENT_IP_TRUSTED_HOPS: "0", TRUST_X_REAL_IP: "yes" });
    const text = report.notices.map((notice) => notice.message).join("\n");
    for (const name of ["STOREFRONT_URL", "STORE_PHONE_COUNTRY_CODE", "CUSTOMER_ACCESS_TOKEN_TTL", "CLIENT_IP_TRUSTED_HOPS", "TRUST_X_REAL_IP"]) expect(text).toContain(name);
  });

  it("flags two audiences sharing a secret, by name", () => {
    const report = prod({ ...REQUIRED, REVALIDATE_SECRET: STAFF });
    expect(report.notices.some((notice) => /STAFF_JWT_SECRET and REVALIDATE_SECRET have the same value/.test(notice.message))).toBe(true);
  });
});

describe("no value ever reaches a message", () => {
  it("none of the secrets or URIs set in a bad environment appears in the report or the thrown error", () => {
    const bad = {
      MONGODB_URI: "mongodb+srv://admin:Sup3rSecretPw@cluster.example/",
      MONGODB_DB: "bad name Sup3rSecretDb",
      STAFF_JWT_SECRET: "Sup3rSecretStaff",
      CUSTOMER_JWT_SECRET: "Sup3rSecretStaff",
      STORE_TIMEZONE: "Sup3rSecretZone",
      REVALIDATE_SECRET: "Sup3rSecretReval",
      STOREFRONT_REVALIDATE_URL: "http://user:Sup3rSecretUrl@shop.example/",
    };
    const report = prod(bad);
    const printed = JSON.stringify(report) + new EnvironmentConfigurationError(report.problems).message;
    expect(printed).not.toContain("Sup3rSecret");
    expect(report.problems.length).toBeGreaterThanOrEqual(4);
  });
});

describe("assertProductionEnvironment", () => {
  it("throws in production, listing every problem by name", () => {
    const attempt = () => assertProductionEnvironment({ ...REQUIRED, STAFF_JWT_SECRET: undefined, STORE_TIMEZONE: undefined }, "production");
    expect(attempt).toThrow(EnvironmentConfigurationError);
    expect(attempt).toThrow(/STAFF_JWT_SECRET: is not set[\s\S]*STORE_TIMEZONE: is not set/);
  });

  it("does not throw outside production, even for a completely empty environment", () => {
    expect(() => assertProductionEnvironment({}, "development")).not.toThrow();
    expect(() => assertProductionEnvironment({}, undefined)).not.toThrow();
  });

  it("returns the notices for the caller to announce", () => {
    expect(assertProductionEnvironment({ ...REQUIRED, REVALIDATE_SECRET: "weak" }, "production")).toHaveLength(1);
  });
});

describe("the declaration table", () => {
  it("has unique names", () => {
    const names = ENV_VARS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("marks credentials secret and plain settings not", () => {
    for (const name of ["MONGODB_URI", "STAFF_JWT_SECRET", "CUSTOMER_JWT_SECRET", "REVALIDATE_SECRET", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "SMTP_PASS"]) expect(isSecretVariable(name)).toBe(true);
    for (const name of ["MONGODB_DB", "STORE_ID", "STORE_TIMEZONE", "SMTP_HOST", "STOREFRONT_URL"]) expect(isSecretVariable(name)).toBe(false);
  });
});
