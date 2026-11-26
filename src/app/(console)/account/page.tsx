import { PageShell } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AccountView } from "src/features/account/account-view";

export const metadata: Metadata = { title: "My account" };

/** Every signed-in staff member may open their own account — no permission guard; the API scopes it to the session. */
export default function AccountPage() {
  return (
    <PageShell title="My account" description="Your profile, your password, and what your roles let you do.">
      <AccountView />
    </PageShell>
  );
}
