/**
 * The shared shell of every email: escaping, the HTML frame, and the plain-text
 * twin. Pure string functions, no I/O.
 *
 * Email HTML is not web HTML: Gmail and Outlook strip `<style>` blocks and
 * ignore external CSS, so every rule is inline, layout is a table, and the page
 * direction is declared on `<html>`, on the wrapper table AND on each text cell
 * (clients keep some and drop others). A plain-text part is always produced —
 * it is what a text-only client, a preview pane and a spam filter read.
 */

export type MailLocale = "ar" | "en";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Escapes text for an HTML text node or a double-quoted attribute. Merchant and customer text is untrusted. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Collapses line breaks so a value interpolated into a subject can never inject a header. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export const isRtl = (locale: MailLocale): boolean => locale === "ar";

export interface EmailAction {
  label: string;
  url: string;
}

export interface EmailContent {
  locale: MailLocale;
  storeName: string;
  heading: string;
  /** Plain text paragraphs; escaped here. */
  paragraphs: string[];
  /** Label/value rows shown under the paragraphs (an order number, a reason). Escaped here. */
  details?: Array<{ label: string; value: string }>;
  action?: EmailAction;
  /** Said under the button: "if the button does not work, copy this link". */
  linkFallbackLabel?: string;
  /** Small print: "ignore this if it was not you", "automated message". */
  footnotes: string[];
}

// Fixed palette: an email cannot read the storefront's CSS variables, and a store's brand colours are data a template must not bake in.
const INK = "#1f2933";
const MUTED = "#5f6c7b";
const LINE = "#dde2e8";
const CANVAS = "#f4f5f7";
const BUTTON = "#1f2933";
const BUTTON_TEXT = "#ffffff";

export function renderEmailHtml(content: EmailContent): string {
  const dir = isRtl(content.locale) ? "rtl" : "ltr";
  const align = isRtl(content.locale) ? "right" : "left";
  const font = "font-family:Tahoma,'Segoe UI',Arial,sans-serif;";
  const cell = (inner: string, extra = "") => `<tr><td dir="${dir}" style="${font}text-align:${align};${extra}">${inner}</td></tr>`;

  const paragraphs = content.paragraphs.map((p) => cell(escapeHtml(p), `font-size:16px;line-height:1.7;color:${INK};padding:0 0 14px;`)).join("");

  const details = content.details?.length
    ? cell(
        content.details
          .map((d) => `<div style="padding:4px 0;"><span style="color:${MUTED};">${escapeHtml(d.label)}:</span> <bdi style="color:${INK};font-weight:bold;">${escapeHtml(d.value)}</bdi></div>`)
          .join(""),
        `font-size:15px;line-height:1.6;padding:0 0 14px;`
      )
    : "";

  const action = content.action
    ? cell(
        `<a href="${escapeHtml(content.action.url)}" style="display:inline-block;background:${BUTTON};color:${BUTTON_TEXT};text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:6px;">${escapeHtml(content.action.label)}</a>`,
        `padding:6px 0 18px;`
      ) +
      cell(
        `${content.linkFallbackLabel ? `<div style="color:${MUTED};padding-bottom:4px;">${escapeHtml(content.linkFallbackLabel)}</div>` : ""}<div dir="ltr" style="text-align:left;word-break:break-all;color:${MUTED};"><a href="${escapeHtml(content.action.url)}" style="color:${MUTED};">${escapeHtml(content.action.url)}</a></div>`,
        `font-size:13px;line-height:1.6;padding:0 0 18px;`
      )
    : "";

  const footnotes = content.footnotes.map((f) => cell(escapeHtml(f), `font-size:13px;line-height:1.6;color:${MUTED};padding:0 0 4px;`)).join("");

  return (
    `<!doctype html><html lang="${content.locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(content.heading)}</title></head>` +
    `<body style="margin:0;padding:0;background:${CANVAS};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="background:${CANVAS};"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:8px;">` +
    `<tr><td dir="${dir}" style="${font}text-align:${align};padding:20px 28px 8px;font-size:14px;color:${MUTED};">${escapeHtml(content.storeName)}</td></tr>` +
    `<tr><td dir="${dir}" style="padding:0 28px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}">` +
    cell(escapeHtml(content.heading), `font-size:22px;line-height:1.4;font-weight:bold;color:${INK};padding:8px 0 14px;`) +
    paragraphs +
    details +
    action +
    `<tr><td style="border-top:1px solid ${LINE};font-size:0;line-height:0;height:1px;padding:0;">&nbsp;</td></tr>` +
    `<tr><td style="height:12px;font-size:0;line-height:0;">&nbsp;</td></tr>` +
    footnotes +
    `</table></td></tr></table></td></tr></table></body></html>`
  );
}

export function renderEmailText(content: EmailContent): string {
  const lines: string[] = [content.heading, ""];
  lines.push(...content.paragraphs.flatMap((p) => [p, ""]));
  if (content.details?.length) lines.push(...content.details.map((d) => `${d.label}: ${d.value}`), "");
  if (content.action) lines.push(`${content.action.label}:`, content.action.url, "");
  lines.push("--", content.storeName, ...content.footnotes);
  return lines.join("\n");
}

/** Joins a base origin and a path with exactly one slash, with the query appended encoded. Never `new URL(path, base)`, which drops a base path. */
export function buildLink(base: string, path: string, query: Record<string, string> = {}): string {
  const search = new URLSearchParams(query).toString();
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}${search ? `?${search}` : ""}`;
}

/** "1 hour" / "30 minutes" / "ساعة واحدة" — a link lifetime in the reader's language. */
export function durationPhrase(minutes: number, locale: MailLocale): string {
  const useHours = minutes >= 60 && minutes % 60 === 0;
  const n = useHours ? minutes / 60 : minutes;
  if (locale === "en") return `${n} ${useHours ? "hour" : "minute"}${n === 1 ? "" : "s"}`;
  const [one, two, few, many] = useHours ? ["ساعة واحدة", "ساعتان", "ساعات", "ساعة"] : ["دقيقة واحدة", "دقيقتان", "دقائق", "دقيقة"];
  if (n === 1) return one!;
  if (n === 2) return two!;
  return n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`;
}
