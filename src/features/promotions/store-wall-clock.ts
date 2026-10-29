/**
 * Converts between an ISO instant and a wall-clock reading ("YYYY-MM-DDTHH:mm", what a
 * datetime-local input holds) in the STORE's time zone, not the browser's. The client has
 * no direct access to the zone, so it is read off the one thing that knows it: the store
 * formatter (`useStoreFormat().dateTime`), whose output is parsed back. Pure given that formatter.
 */
export type StoreDateTimeFormatter = (iso: string) => string;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Reads "02 Oct 2026, 14:30" (en-GB, 24h) as a UTC-based tuple; null when it is not that shape. */
function readFormatted(text: string): number | null {
  const match = /(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4}).*?(\d{2}):(\d{2})/.exec(text);
  if (!match) return null;
  const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase());
  if (month < 0) return null;
  return Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]));
}

const pad = (n: number) => String(n).padStart(2, "0");
const MINUTE = 60_000;

function storeOffset(instantMs: number, format: StoreDateTimeFormatter): number | null {
  const floored = Math.floor(instantMs / MINUTE) * MINUTE;
  const wall = readFormatted(format(new Date(floored).toISOString()));
  return wall === null ? null : wall - floored;
}

export function instantToWall(iso: string | undefined, format: StoreDateTimeFormatter): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const offset = storeOffset(ms, format);
  if (offset === null) return "";
  const d = new Date(Math.floor(ms / MINUTE) * MINUTE + offset);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** The instant at which the store's clock reads `wall`; "" for an empty or invalid reading. */
export function wallToInstant(wall: string, format: StoreDateTimeFormatter): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
  if (!match) return "";
  const asUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  const first = storeOffset(asUtc, format);
  if (first === null) return "";
  const guess = asUtc - first;
  const second = storeOffset(guess, format) ?? first;
  return new Date(asUtc - second).toISOString();
}
