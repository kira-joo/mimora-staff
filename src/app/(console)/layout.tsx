import { Suspense, type ReactNode } from "react";
import { ConsoleShell, type ConsoleUser } from "src/components/console-shell";
import { SessionRedirect } from "src/components/session-redirect";
import { StoreFormatProvider } from "src/common/format/store-format";
import { getSingletonSettings } from "src/server/admin/settings/singleton-settings";
import { storeTimeZone } from "src/server/core/config/store-timezone";
import { storeProfileRepository } from "src/server/core/repositories";
import { getCurrentStaffUser } from "src/server/core/auth/current-staff-user";

/**
 * Every console page sits behind this layout. It resolves the staff member
 * for the shell and redirects to sign-in without a session — a convenience,
 * not the gate: the data on every page comes from /api/admin, which
 * authenticates and authorizes each request itself.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentStaffUser();
  if (!user) {
    return (
      <Suspense>
        <SessionRedirect />
      </Suspense>
    );
  }
  // Display settings only: the currency money is shown in, and the zone dates are shown in.
  const profile = await getSingletonSettings(storeProfileRepository);
  return (
    <StoreFormatProvider currency={profile.currency || undefined} timeZone={storeTimeZone()}>
      <ConsoleShell user={JSON.parse(JSON.stringify(user)) as ConsoleUser}>{children}</ConsoleShell>
    </StoreFormatProvider>
  );
}
