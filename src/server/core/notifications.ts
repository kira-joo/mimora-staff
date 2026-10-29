import type { OutboundNotifier } from "../engines/notifications/outbound-notifier";
import { selectOutboundNotifier } from "./mail/select-notifier";
import { createSmtpTransport } from "./mail/smtp-transport";

/**
 * The one shared `OutboundNotifier` for the whole process — SMTP when mail is
 * fully configured, the logging no-op otherwise (`core/mail/select-notifier.ts`).
 *
 * Created once, here, so the SMTP connection pool is one pool and not one per
 * call site. Kept on `globalThis` as well: Turbopack and hot reload can evaluate
 * this module more than once in a process, and each copy would otherwise own a
 * pool of its own.
 *
 * It does NOT announce its state — the boot announcement does, from
 * `instrumentation.ts`. An announcement made by constructing this module fires on
 * whichever route is imported first, which is not startup.
 */
const GLOBAL_KEY = Symbol.for("store-platform-staff.outboundNotifier");
type Holder = { [GLOBAL_KEY]?: OutboundNotifier };
const holder = globalThis as unknown as Holder;

export const outboundNotifier: OutboundNotifier = (holder[GLOBAL_KEY] ??= selectOutboundNotifier(process.env, { createTransport: createSmtpTransport }));
