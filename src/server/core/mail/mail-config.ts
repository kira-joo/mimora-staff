/**
 * Reads the mail environment and classifies it. Pure — `env` is a parameter —
 * so every state is testable without touching `process.env`.
 *
 * Three states, and the third is the dangerous one:
 *  - **configured** — every required variable is present and valid: deliver through SMTP.
 *  - **off** — none of the mail variables is set: nothing is delivered, and that is a choice (local development).
 *  - **half-configured** — some are set, some missing or invalid: also nothing is delivered, but this is a typo or a
 *    forgotten secret, and from the outside it is indistinguishable from "working" — so it is named at boot.
 *
 * Messages name VARIABLES, never values: a host, a username or a password must not reach a log.
 */
export interface MailConfig {
  host: string;
  port: number;
  /** TLS from the first byte (port 465). On 587 the connection upgrades with STARTTLS instead — see `requireTLS`. */
  secure: boolean;
  /** Refuse to send in clear text if STARTTLS is not offered. Always on for submission port 587. */
  requireTLS: boolean;
  user?: string;
  pass?: string;
  /** `MAIL_FROM` — a bare address or `Name <address>`. */
  from: string;
  replyTo?: string;
  /** The customer storefront's public origin — no trailing slash. Links in customer emails are built on it. */
  storefrontUrl: string;
  /** The console's public origin — no trailing slash. The staff invitation link is built on it. */
  backofficeUrl: string;
}

export type MailConfigStatus =
  | { state: "configured"; config: MailConfig; message: string }
  | { state: "off"; message: string }
  | { state: "half-configured"; problems: string[]; message: string };

type Env = Record<string, string | undefined>;

/** Setting any of these means somebody meant to configure mail. The two URLs are deliberately absent: a base URL alone is not an intent to send. */
const TRANSPORT_VARIABLES = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "MAIL_REPLY_TO"] as const;

const clean = (value: string | undefined) => value?.trim() || undefined;

function parseOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function mailConfigStatus(env: Env): MailConfigStatus {
  if (!TRANSPORT_VARIABLES.some((name) => clean(env[name]))) {
    return {
      state: "off",
      message:
        "no mail variables are set (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM), so NO email is delivered. " +
        "Verification and password-reset emails, staff invitations and order emails are only logged by template name.",
    };
  }

  const problems: string[] = [];

  const host = clean(env.SMTP_HOST);
  if (!host) problems.push("SMTP_HOST");

  const portText = clean(env.SMTP_PORT);
  const port = portText ? Number(portText) : NaN;
  const portValid = Number.isInteger(port) && port > 0 && port < 65536;
  if (!portText) problems.push("SMTP_PORT");
  else if (!portValid) problems.push("SMTP_PORT (not a valid port number)");

  // `SMTP_SECURE` is true only for 465 (implicit TLS). Unset, it follows the port.
  const secureText = clean(env.SMTP_SECURE)?.toLowerCase();
  let secure = portValid && port === 465;
  if (secureText !== undefined) {
    if (secureText !== "true" && secureText !== "false") {
      problems.push("SMTP_SECURE (must be true or false)");
    } else {
      secure = secureText === "true";
      if (portValid && secure !== (port === 465)) {
        problems.push(secure ? "SMTP_SECURE (true is only for port 465)" : "SMTP_SECURE (port 465 needs true)");
      }
    }
  }

  const user = clean(env.SMTP_USER);
  const pass = env.SMTP_PASS ? env.SMTP_PASS : undefined;
  if (user && !pass) problems.push("SMTP_PASS");
  if (pass && !user) problems.push("SMTP_USER");

  const from = clean(env.MAIL_FROM);
  if (!from) problems.push("MAIL_FROM");

  const storefrontUrl = parseOrigin(clean(env.STOREFRONT_URL));
  if (!storefrontUrl) problems.push(clean(env.STOREFRONT_URL) ? "STOREFRONT_URL (not an http(s) URL)" : "STOREFRONT_URL");
  const backofficeUrl = parseOrigin(clean(env.BACKOFFICE_URL));
  if (!backofficeUrl) problems.push(clean(env.BACKOFFICE_URL) ? "BACKOFFICE_URL (not an http(s) URL)" : "BACKOFFICE_URL");

  if (problems.length > 0 || !host || !portValid || !from || !storefrontUrl || !backofficeUrl) {
    return {
      state: "half-configured",
      problems,
      message: `mail is half-configured: missing or invalid ${problems.join(", ")}. NO email is delivered until it is complete.`,
    };
  }

  return {
    state: "configured",
    message: "SMTP delivery is configured.",
    config: {
      host,
      port,
      secure,
      requireTLS: port === 587,
      ...(user && pass ? { user, pass } : {}),
      from,
      ...(clean(env.MAIL_REPLY_TO) ? { replyTo: clean(env.MAIL_REPLY_TO) } : {}),
      storefrontUrl,
      backofficeUrl,
    },
  };
}

export interface MailAnnouncement {
  level: "info" | "warn" | "error";
  message: string;
}

/**
 * The one line boot prints about mail. Configured is plain information; OFF and half-configured are loud —
 * `error` in production, `warn` elsewhere — which is the repo-wide rule that a capability configured OFF must
 * not degrade into something indistinguishable from a working one.
 */
export function mailAnnouncement(status: MailConfigStatus, nodeEnv: string | undefined): MailAnnouncement {
  if (status.state === "configured") return { level: "info", message: `[mail] ${status.message}` };
  return { level: nodeEnv === "production" ? "error" : "warn", message: `[mail] ${status.message}` };
}

/** Writes the announcement to the console at its level. Called once, from `instrumentation.ts`. */
export function announceMailStatus(status: MailConfigStatus, nodeEnv: string | undefined, sink: Pick<Console, "log" | "warn" | "error"> = console): void {
  const { level, message } = mailAnnouncement(status, nodeEnv);
  (level === "info" ? sink.log : level === "warn" ? sink.warn : sink.error)(message);
}

/**
 * The two link bases, normalised, or `""` when absent or invalid. Links are only ever BUILT when delivery is
 * configured (both bases are then guaranteed valid); the empty fallback just lets a template render while mail is
 * OFF, where the message is logged by name and never read.
 */
export function mailLinkBases(env: Env): { storefrontUrl: string; backofficeUrl: string } {
  return { storefrontUrl: parseOrigin(clean(env.STOREFRONT_URL)) ?? "", backofficeUrl: parseOrigin(clean(env.BACKOFFICE_URL)) ?? "" };
}
