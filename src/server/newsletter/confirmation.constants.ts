/** How long the emailed link works. Long enough to be read the next day, short enough that an old inbox is not a standing key. */
export const NEWSLETTER_CONFIRMATION_TTL_MS = 48 * 60 * 60 * 1000;

/** A pending address is re-sent a link at most this often, so the public form cannot be used to mail-bomb someone. */
export const NEWSLETTER_RESEND_AFTER_MS = 10 * 60 * 1000;
