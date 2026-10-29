import type { Metadata } from "next";
import { Suspense } from "react";
import { AcceptInviteForm } from "src/features/auth/accept-invite-form";

export const metadata: Metadata = { title: "Activate account" };

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  );
}
