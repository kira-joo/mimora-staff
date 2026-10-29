"use client";

import { AuthUserProvider, clearAuthenticatedQueries, requester, type AuthUser } from "@kira-joo/frontend-toolkit-core";
import { DialogProvider } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { SideNav, SideNavProvider, SideNavTrigger } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { LogOut } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { logoutEndpoint } from "src/api/auth.endpoints";
import { DIALOG_LABELS } from "src/common/config/dialog-labels.constant";
import { CONSOLE_NAV } from "src/common/navigation/console-nav";
import { AppRoute } from "src/common/routes/app-route";
import { NotificationBell } from "src/features/notifications/notification-bell";
import { queryClient } from "src/providers/app-providers";

export type ConsoleUser = AuthUser & { name?: string; email?: string };

/**
 * The authenticated frame: the toolkit's SideNav (permission-filtered,
 * collapsible, a drawer below `md`) beside a top bar carrying the menu
 * trigger, who is signed in, and sign-out. The user was resolved on the
 * server, so permission-aware UI is correct on the first paint.
 *
 * Dialogs mount here, not at the app root: a drawer or confirm renders
 * outside the page's tree, so it must sit inside the providers it reads —
 * the signed-in user for permissions, the store's money and date format.
 */
export function ConsoleShell({ user, children }: { user: ConsoleUser; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <AuthUserProvider user={user}>
      <DialogProvider labels={DIALOG_LABELS}>
        <SideNavProvider persistCollapsed>
          <div className="flex h-dvh overflow-hidden">
            <SideNav pathname={pathname} brand={{ type: "title", title: "Store console", shortLabel: "SC" }} sections={CONSOLE_NAV} />
            <div className="flex min-w-0 flex-1 flex-col">
              <ConsoleTopBar user={user} />
              <main id="main" className="min-h-0 flex-1 overflow-y-auto">
                {children}
              </main>
            </div>
          </div>
        </SideNavProvider>
      </DialogProvider>
    </AuthUserProvider>
  );
}

function ConsoleTopBar({ user }: { user: ConsoleUser }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const role = user.roles.find((r) => r.grantsAll)?.name ?? user.roles[0]?.name;

  async function signOut() {
    setSigningOut(true);
    // Idempotent on the server: an already-dead session is still a sign-out, so a failure here never traps anyone.
    await requester(logoutEndpoint, {}).catch(() => undefined);
    clearAuthenticatedQueries(queryClient);
    router.replace(AppRoute.LOGIN);
    router.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--st-line)] bg-[var(--st-surface)] px-3 sm:px-5">
      <SideNavTrigger />
      <div className="ms-auto flex min-w-0 items-center gap-3">
        <NotificationBell />
        <div className="min-w-0 text-end leading-tight">
          <p className="truncate font-medium text-[var(--st-ink)]" dir="auto">
            {user.name ?? user.email}
          </p>
          <p className="truncate text-[13px] text-[var(--st-ink-muted)]">{role ?? "No role"}</p>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="inline-flex h-[var(--st-tap-min)] shrink-0 items-center gap-2 border border-[var(--st-line-strong)] px-3 text-[13px] font-medium text-[var(--st-ink)] transition-colors duration-[var(--st-duration-fast)] hover:bg-[var(--st-canvas)] disabled:opacity-60"
        >
          <LogOut aria-hidden="true" className="size-4" />
          <span>{signingOut ? "Signing out…" : "Sign out"}</span>
        </button>
      </div>
    </header>
  );
}
