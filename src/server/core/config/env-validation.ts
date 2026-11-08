import { isValidCountryCallingCode } from "../phone/normalize-phone";
import { STORE_ID_PATTERN, STORE_ID_RULE } from "../db/store-identity";

/**
 * The one declaration of every environment variable this application reads.
 *
 * ## Why one module
 *
 * Environment configuration fails in production in ways `localhost` hides: a
 * variable a developer's shell happens to provide, a default that quietly covers
 * a missing value, a secret that is present but is the placeholder from the
 * example file. Each variable is declared here once — what it is, whether the
 * process may run without it, whether its value is a secret, and how to tell a
 * usable value from an unusable one — and `env-inventory.test.ts` fails when
 * the code reads a variable this table does not declare, so a new one cannot
 * slip in undocumented.
 *
 * ## Three tiers, and what each does at boot
 *
 *  - **required** — the application cannot do its job without it (database,
 *    both JWT secrets, the store's id and time zone). In PRODUCTION a missing or invalid
 *    one stops the process (`assertProductionEnvironment`); the message lists
 *    NAMES and reasons, never a value.
 *  - **capability** — switches a feature on (cache invalidation, uploads, email,
 *    phone normalisation). Absent is a legitimate "OFF" and is
 *    announced by the module that owns the capability (`revalidationConfigStatus`,
 *    `mailConfigStatus`, `missingCloudinaryVariables`, and the
 *    phone line in `instrumentation.ts`) — those announcements are unchanged. What
 *    THIS module adds is the case they cannot see: a capability variable that is
 *    SET but unusable (a weak secret, a non-https URL in production, a malformed
 *    number). That is reported as an `error` notice, never fatal, because the rest
 *    of the application is unaffected.
 *  - **optional** — has a safe default; validated only when set.
 *
 * `provided` variables are set by the runtime (`NODE_ENV`, `NEXT_RUNTIME`);
 * nobody configures them, and they are declared only so the inventory is whole.
 *
 * Pure: `env` is a parameter, so every rule is testable without `process.env`.
 */
export type EnvRequirement = "required" | "capability" | "optional" | "provided";

type Env = Record<string, string | undefined>;

export interface EnvVarSpec {
  name: string;
  requirement: EnvRequirement;
  /** Its value must never be logged, echoed, or written to a document. */
  secret: boolean;
  /** One line, for the generated documentation and the example file. */
  description: string;
  /** Returns the reason the VALUE is unusable (never the value itself), or `null`. Called only when the variable is set. */
  validate?: (value: string, context: { production: boolean }) => string | null;
}

/** A placeholder from `.env.example`, left in place. At least 32 characters, so a length check alone would let it through. */
const PLACEHOLDER_PREFIX = "replace-with";

const MIN_SECRET_LENGTH = 32;

function secretProblem(value: string, production: boolean): string | null {
  if (value.length < MIN_SECRET_LENGTH) return `must be at least ${MIN_SECRET_LENGTH} characters (openssl rand -base64 48)`;
  if (production && value.toLowerCase().startsWith(PLACEHOLDER_PREFIX)) return "is still the placeholder from .env.example";
  return null;
}

const secret = (value: string, { production }: { production: boolean }) => secretProblem(value, production);

/**
 * A loopback origin is exempt from the https-in-production rule: a production build served on this machine (CI's
 * configuration proof, a local smoke run) is legitimate, and no real deployment can be reached at loopback, so the
 * exemption cannot let a public deploy go out over plain http.
 */
function isLoopback(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function urlProblem(value: string, production: boolean, { origin }: { origin: boolean }): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "must be an absolute URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "must be an http(s) URL";
  if (production && url.protocol !== "https:" && !isLoopback(url)) return "must be https in production";
  if (origin && (url.search || url.hash)) return "must not carry a query string or fragment";
  return null;
}

const httpUrl = (value: string, { production }: { production: boolean }) => urlProblem(value, production, { origin: true });
const endpointUrl = (value: string, { production }: { production: boolean }) => urlProblem(value, production, { origin: false });

function timeZoneProblem(value: string): string | null {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() });
    return null;
  } catch {
    return "is not a recognised IANA time zone (e.g. Africa/Cairo)";
  }
}

export const ENV_VARS: readonly EnvVarSpec[] = [
  // Runtime-provided
  { name: "NODE_ENV", requirement: "provided", secret: false, description: "Set by Next (`production` under `next start`). Never set it by hand." },
  { name: "NEXT_RUNTIME", requirement: "provided", secret: false, description: "Set by Next to tell the node and edge runtimes apart." },
  { name: "NEXT_PHASE", requirement: "provided", secret: false, description: "Set by Next; distinguishes `next build` from a running server. The boot gate is skipped during the build." },

  // Database
  {
    name: "MONGODB_URI",
    requirement: "required",
    secret: true,
    description: "Connection string. Must reach a replica set — order placement is a transaction. Carries credentials.",
    validate: (value) => (/^mongodb(\+srv)?:\/\//.test(value) ? null : "must start with mongodb:// or mongodb+srv://"),
  },
  {
    name: "MONGODB_DB",
    requirement: "required",
    secret: false,
    description: "Database name. Set it explicitly per environment; two environments must never share one.",
    validate: (value) => (/^[A-Za-z0-9_-]{1,63}$/.test(value) ? null : "must be 1-63 letters, digits, hyphens or underscores"),
  },

  // Authentication
  { name: "STAFF_JWT_SECRET", requirement: "required", secret: true, description: "Signs staff access tokens. At least 32 characters; different from every other secret.", validate: secret },
  { name: "CUSTOMER_JWT_SECRET", requirement: "required", secret: true, description: "Signs customer tokens and guest order-tracking tokens. At least 32 characters; different from the staff secret.", validate: secret },
  {
    name: "CUSTOMER_ACCESS_TOKEN_TTL",
    requirement: "optional",
    secret: false,
    description: "Customer access-token lifetime, e.g. 15m (the default).",
    validate: (value) => (/^\d+\s?(s|m|h|d)$/.test(value) ? null : "must be a number followed by s, m, h or d (e.g. 15m)"),
  },

  // Store
  {
    name: "STORE_ID",
    requirement: "required",
    secret: false,
    description:
      "This store's stable slug (mimora). The database's identity marker must name it (scripts/admin/adopt-store-identity.mjs) and the storefront must carry the same value. Never change it once adopted.",
    validate: (value) => (STORE_ID_PATTERN.test(value) ? null : `must be ${STORE_ID_RULE} (e.g. mimora)`),
  },
  { name: "STORE_TIMEZONE", requirement: "required", secret: false, description: "The store's IANA time zone. Must equal the storefront's value.", validate: timeZoneProblem },
  {
    name: "STORE_PHONE_COUNTRY_CODE",
    requirement: "capability",
    secret: false,
    description: "Default country calling code for national phone numbers, digits only (20, 966). Unset: numbers are stored as typed.",
    validate: (value) => (isValidCountryCallingCode(value.trim()) ? null : "must be a country calling code, 1-3 digits, no +"),
  },

  // Cache invalidation
  {
    name: "STOREFRONT_REVALIDATE_URL",
    requirement: "capability",
    secret: false,
    description: "The storefront's full /api/revalidate URL. Set together with REVALIDATE_SECRET.",
    validate: endpointUrl,
  },
  { name: "REVALIDATE_SECRET", requirement: "capability", secret: true, description: "Shared with the storefront; sent as X-Revalidate-Secret. Must equal the storefront's value.", validate: secret },

  // Uploads
  { name: "CLOUDINARY_CLOUD_NAME", requirement: "capability", secret: false, description: "Cloudinary cloud name. All three CLOUDINARY_* or none." },
  { name: "CLOUDINARY_API_KEY", requirement: "capability", secret: true, description: "Cloudinary API key." },
  { name: "CLOUDINARY_API_SECRET", requirement: "capability", secret: true, description: "Cloudinary API secret. Server-only." },

  // Email
  { name: "SMTP_HOST", requirement: "capability", secret: false, description: "SMTP relay hostname. Setting any mail variable asks for the rest." },
  { name: "SMTP_PORT", requirement: "capability", secret: false, description: "587 (STARTTLS) or 465 (implicit TLS)." },
  { name: "SMTP_SECURE", requirement: "capability", secret: false, description: "true only for port 465. Unset follows the port." },
  { name: "SMTP_USER", requirement: "capability", secret: false, description: "SMTP username. With SMTP_PASS, or neither." },
  { name: "SMTP_PASS", requirement: "capability", secret: true, description: "SMTP password or API key. With SMTP_USER, or neither." },
  { name: "MAIL_FROM", requirement: "capability", secret: false, description: "Sender, e.g. Store <orders@shop.example>. Must be verified with the provider." },
  { name: "MAIL_REPLY_TO", requirement: "capability", secret: false, description: "Where customer replies go." },
  { name: "STOREFRONT_URL", requirement: "capability", secret: false, description: "The storefront's public origin; links in customer emails are built on it. Required once mail is set.", validate: httpUrl },
  { name: "BACKOFFICE_URL", requirement: "capability", secret: false, description: "This console's public origin; the staff invitation link is built on it. Required once mail is set.", validate: httpUrl },


  // Network trust
  { name: "CLIENT_IP_TRUSTED_HOPS", requirement: "optional", secret: false, description: "How many right-most X-Forwarded-For entries are infrastructure you control (default 1).", validate: (value) => (/^[1-9]\d{0,1}$/.test(value) ? null : "must be a whole number from 1 to 99") },
  { name: "TRUST_X_REAL_IP", requirement: "optional", secret: false, description: "1 only behind a proxy that overwrites X-Real-IP.", validate: (value) => (value === "1" || value === "0" ? null : "must be 1 or unset") },
];

export const ENV_VAR_NAMES: ReadonlySet<string> = new Set(ENV_VARS.map((spec) => spec.name));

export function isSecretVariable(name: string): boolean {
  return ENV_VARS.find((spec) => spec.name === name)?.secret === true;
}

const clean = (value: string | undefined) => value?.trim() || undefined;

export interface EnvNotice {
  level: "error" | "warn";
  message: string;
}

export interface EnvironmentReport {
  /** Required variables that are missing or unusable. Fatal in production. Names and reasons only. */
  problems: string[];
  /** Capability or optional variables that are set but unusable, plus cross-variable hazards. Loud, never fatal. */
  notices: EnvNotice[];
}

/** Values that must be pairwise different: two audiences never share a secret. */
const DISTINCT_SECRETS: ReadonlyArray<readonly string[]> = [["STAFF_JWT_SECRET"], ["CUSTOMER_JWT_SECRET"], ["REVALIDATE_SECRET"]];

/**
 * Classifies an environment. Values never appear in the report: every message is
 * written from the variable's name and a fixed reason.
 *
 * `production` controls strictness only (https, the placeholder check); the
 * caller decides whether `problems` stops the process.
 */
export function validateEnvironment(env: Env, { production }: { production: boolean }): EnvironmentReport {
  const problems: string[] = [];
  const notices: EnvNotice[] = [];

  for (const spec of ENV_VARS) {
    if (spec.requirement === "provided") continue;
    const value = clean(env[spec.name]);

    if (!value) {
      if (spec.requirement === "required") problems.push(`${spec.name}: is not set`);
      continue;
    }
    const reason = spec.validate?.(value, { production }) ?? null;
    if (!reason) continue;
    if (spec.requirement === "required") problems.push(`${spec.name}: ${reason}`);
    else notices.push({ level: "error", message: `[config] ${spec.name} ${reason} — the capability it configures will not work as intended.` });
  }

  // Two audiences never share a secret. Reported by name only.
  const present = DISTINCT_SECRETS.map((names) => ({ names, value: names.map((name) => clean(env[name])).find(Boolean) })).filter((entry) => entry.value);
  for (let i = 0; i < present.length; i += 1) {
    for (let j = i + 1; j < present.length; j += 1) {
      if (present[i]!.value !== present[j]!.value) continue;
      const message = `${present[i]!.names[0]} and ${present[j]!.names[0]} have the same value — two audiences must never share a secret`;
      if (present[i]!.names[0] === "STAFF_JWT_SECRET" && present[j]!.names[0] === "CUSTOMER_JWT_SECRET") problems.push(`CUSTOMER_JWT_SECRET: must differ from STAFF_JWT_SECRET`);
      else notices.push({ level: "error", message: `[config] ${message}.` });
    }
  }

  const uri = clean(env.MONGODB_URI);
  if (uri && /^mongodb:\/\//.test(uri) && !/[?&]replicaSet=/i.test(uri)) {
    notices.push({
      level: "warn",
      message: "[config] MONGODB_URI names no replicaSet — order placement is a transaction and fails on a standalone node. Ignore this only if the topology is a replica set discovered another way.",
    });
  }

  return { problems, notices };
}

/** The error production boot throws. Carries names and reasons only. */
export class EnvironmentConfigurationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `Invalid production configuration — ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n` +
        problems.map((problem) => `  - ${problem}`).join("\n") +
        "\nValues are never printed. See docs/configuration.md and docs/deployment.md."
    );
    this.name = "EnvironmentConfigurationError";
    this.problems = problems;
  }
}

/**
 * Production boot gate: throws `EnvironmentConfigurationError` when a REQUIRED
 * variable is missing or unusable; outside production does nothing (a developer
 * without a storefront, or with a short local secret, must be able to start).
 *
 * Returns the notices so the caller announces them — this function does not log.
 */
export function assertProductionEnvironment(env: Env, nodeEnv: string | undefined): EnvNotice[] {
  const production = nodeEnv === "production";
  const report = validateEnvironment(env, { production });
  if (production && report.problems.length > 0) throw new EnvironmentConfigurationError(report.problems);
  return report.notices;
}
