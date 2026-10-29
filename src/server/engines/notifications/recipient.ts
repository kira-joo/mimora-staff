/**
 * What may be written to a log about a notification's recipient.
 *
 * A full address or phone number is personal data that must not sit in log
 * storage, so logs carry a masked form (to tell two sends apart while
 * debugging) and, on a transport failure, only the address's domain (to tell
 * "Gmail is rejecting us" from "one bad address").
 */

/** `ahmed@example.com` → `a***@example.com`; `+201012345678` → `+2***78`. Never throws. */
export function maskRecipient(to: string): string {
  const value = (to ?? "").trim();
  if (!value) return "(none)";
  const at = value.lastIndexOf("@");
  if (at > 0) return `${value.slice(0, 1)}***${value.slice(at)}`;
  if (value.length <= 4) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

/** The part after the last `@`, lower-cased, or `"(unknown)"` for something that is not an email address. */
export function recipientDomain(to: string): string {
  const value = (to ?? "").trim();
  const at = value.lastIndexOf("@");
  if (at < 0 || at === value.length - 1) return "(unknown)";
  return value.slice(at + 1).toLowerCase();
}
