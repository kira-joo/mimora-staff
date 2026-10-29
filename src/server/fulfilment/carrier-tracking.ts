import { ValidationFailedError } from "@kira-joo/backend-toolkit-core";

/**
 * Carrier tracking links: a store configures the carriers it uses, each with a URL template, and staff enter a
 * carrier + tracking number on an order. Pure — no I/O — so the same rules run in the settings route, the
 * transition route, and the tests.
 *
 * There is no carrier integration here (a v2 item): a carrier is a name and a link pattern, nothing more.
 */
export const TRACKING_PLACEHOLDER = "{tracking}";

export interface Carrier {
  key: string;
  name: string;
  urlTemplate: string;
}

/** What staff enter. Both fields or neither. */
export interface TrackingInput {
  carrierKey?: string;
  trackingNumber?: string;
}

/** What is stored on the order — `carrierName` and `url` are frozen at entry (see `Order.tracking`). */
export interface TrackingSnapshot {
  carrierKey: string;
  carrierName: string;
  trackingNumber: string;
  url: string;
}

export interface FieldProblem {
  field: string;
  messages: string[];
}

const CARRIER_KEY = /^[a-z0-9][a-z0-9-]{0,31}$/;
const TRACKING_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/;
export const MAX_CARRIERS = 20;
export const MAX_TRACKING_NUMBER_LENGTH = 64;
export const MAX_URL_TEMPLATE_LENGTH = 500;

/**
 * Why a template is unusable, or `undefined` when it is fine.
 *
 * It must be an `https` URL (a tracking page is opened from a customer's order page; `http`, `javascript:` and
 * `data:` have no place there), carry credentials nowhere, and place `{tracking}` after the host — a tracking
 * number inside the authority (`https://{tracking}.example.com`) would let whoever types the number choose where
 * the link goes. Any other `{…}` placeholder is refused rather than shipped literally.
 */
export function validateUrlTemplate(template: string): string | undefined {
  if (typeof template !== "string" || template.length === 0) return "A URL template is required.";
  if (template.length > MAX_URL_TEMPLATE_LENGTH) return `The URL template must be at most ${MAX_URL_TEMPLATE_LENGTH} characters.`;
  if (/\s/.test(template)) return "The URL template must not contain spaces.";
  if (!template.startsWith("https://")) return "The URL template must start with https://.";
  if (!template.includes(TRACKING_PLACEHOLDER)) return `The URL template must contain ${TRACKING_PLACEHOLDER}.`;

  const withoutPlaceholder = template.split(TRACKING_PLACEHOLDER).join("");
  if (/[{}]/.test(withoutPlaceholder)) return `Only ${TRACKING_PLACEHOLDER} may appear in braces.`;

  const afterScheme = template.slice("https://".length);
  const authorityEnd = afterScheme.search(/[/?#]/);
  if (authorityEnd === -1 || afterScheme.slice(0, authorityEnd).includes(TRACKING_PLACEHOLDER) || afterScheme.indexOf(TRACKING_PLACEHOLDER) < authorityEnd) {
    return `${TRACKING_PLACEHOLDER} must come after the host, in the path or query.`;
  }

  let parsed: URL;
  try {
    parsed = new URL(template.split(TRACKING_PLACEHOLDER).join("TRACKING123"));
  } catch {
    return "The URL template is not a valid URL.";
  }
  if (parsed.protocol !== "https:" || !parsed.hostname) return "The URL template must be an https URL with a host.";
  if (parsed.username || parsed.password) return "The URL template must not contain credentials.";
  return undefined;
}

/** Why a tracking number is unusable, or `undefined`. A tracking number is a short code a courier prints; it is also placed in a URL. */
export function validateTrackingNumber(trackingNumber: string): string | undefined {
  const value = trackingNumber.trim();
  if (value.length === 0) return "A tracking number is required.";
  if (value.length > MAX_TRACKING_NUMBER_LENGTH) return `The tracking number must be at most ${MAX_TRACKING_NUMBER_LENGTH} characters.`;
  if (!TRACKING_NUMBER.test(value)) return "The tracking number may contain only letters, digits, spaces and . _ / -.";
  return undefined;
}

/** The link a customer is given: the template with the number percent-encoded into it. */
export function resolveTrackingUrl(urlTemplate: string, trackingNumber: string): string {
  return urlTemplate.split(TRACKING_PLACEHOLDER).join(encodeURIComponent(trackingNumber.trim()));
}

/** Problems with a carrier list as a whole: shape of each entry, and keys unique. Empty means valid. */
export function carrierListProblems(carriers: readonly Carrier[]): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (carriers.length > MAX_CARRIERS) problems.push({ field: "carriers", messages: [`At most ${MAX_CARRIERS} carriers.`] });

  const seen = new Set<string>();
  carriers.forEach((carrier, index) => {
    const at = `carriers.${index}`;
    if (!CARRIER_KEY.test(carrier.key)) problems.push({ field: `${at}.key`, messages: ["A carrier key is lowercase letters, digits and hyphens (up to 32)."] });
    else if (seen.has(carrier.key)) problems.push({ field: `${at}.key`, messages: [`Carrier key "${carrier.key}" is used twice.`] });
    seen.add(carrier.key);
    if (carrier.name.trim().length === 0 || carrier.name.length > 80) problems.push({ field: `${at}.name`, messages: ["A carrier name is 1 to 80 characters."] });
    const templateProblem = validateUrlTemplate(carrier.urlTemplate);
    if (templateProblem) problems.push({ field: `${at}.urlTemplate`, messages: [templateProblem] });
  });
  return problems;
}

/**
 * Turns what staff typed into the snapshot to store, or `undefined` when they entered nothing.
 *
 * Carrier and number are validated TOGETHER: one without the other is refused (a carrier with no number has no link,
 * and a number with no carrier has nowhere to go), as is a carrier the store has not configured. Throws
 * `ValidationFailedError`, so the route answers 400 with per-field messages the form can map.
 */
export function buildTrackingSnapshot(input: TrackingInput, carriers: readonly Carrier[]): TrackingSnapshot | undefined {
  const carrierKey = input.carrierKey?.trim() || undefined;
  const trackingNumber = input.trackingNumber?.trim() || undefined;
  if (!carrierKey && !trackingNumber) return undefined;

  const problems: FieldProblem[] = [];
  if (!carrierKey) problems.push({ field: "carrierKey", messages: ["Choose the carrier this tracking number belongs to."] });
  if (!trackingNumber) problems.push({ field: "trackingNumber", messages: ["Enter the tracking number for this carrier."] });
  if (problems.length > 0) throw new ValidationFailedError(problems);

  const carrier = carriers.find((candidate) => candidate.key === carrierKey);
  if (!carrier) throw new ValidationFailedError([{ field: "carrierKey", messages: ["This carrier is not configured."] }]);

  const numberProblem = validateTrackingNumber(trackingNumber!);
  if (numberProblem) throw new ValidationFailedError([{ field: "trackingNumber", messages: [numberProblem] }]);

  return { carrierKey: carrier.key, carrierName: carrier.name, trackingNumber: trackingNumber!, url: resolveTrackingUrl(carrier.urlTemplate, trackingNumber!) };
}
