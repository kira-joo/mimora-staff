import { Suspense, type ReactNode } from "react";
import { SessionRedirect } from "src/components/session-redirect";
import { StoreFormatProvider } from "src/common/format/store-format";
import { getSingletonSettings } from "src/server/admin/settings/singleton-settings";
import { storeTimeZone } from "src/server/core/config/store-timezone";
import { storeProfileRepository } from "src/server/core/repositories";
import { getCurrentStaffUser } from "src/server/core/auth/current-staff-user";
import "./print/print.css";

/**
 * The shell for printable documents: the console's sign-in redirect and store formatting, and NOTHING else — no
 * navigation, no header, nothing to hide when the page is printed. As in the console layout, the redirect is a
 * convenience, not the gate: each document's data comes from an /api/admin route that authenticates and authorizes
 * the request itself (Order.readOne for one order, Order.read for a picking list).
 */
export default async function PrintLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentStaffUser();
  if (!user) {
    return (
      <Suspense>
        <SessionRedirect />
      </Suspense>
    );
  }
  const profile = await getSingletonSettings(storeProfileRepository);
  return (
    <StoreFormatProvider currency={profile.currency || undefined} timeZone={storeTimeZone()}>
      <main>{children}</main>
    </StoreFormatProvider>
  );
}
