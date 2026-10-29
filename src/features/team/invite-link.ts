import { AppRoute } from "src/common/routes/app-route";

/**
 * The accept-invite link an administrator hands over. The accept page reads the
 * code from `?token=` (accept-invite-form.tsx), so that is the one parameter.
 */
export function buildInviteLink(origin: string, token: string): string {
  return `${origin}${AppRoute.ACCEPT_INVITE}?token=${encodeURIComponent(token)}`;
}
