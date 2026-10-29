import { hasPermission } from "@kira-joo/frontend-toolkit-core/server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NoAccess } from "src/components/no-access";
import { firstPermittedRoute } from "src/common/navigation/console-nav";
import { getCurrentStaffUser } from "src/server/core/auth/current-staff-user";
import { todaySectionsFor } from "src/server/engines/today/today-sections";
import { TodayView } from "src/features/today/today-view";

export const metadata: Metadata = { title: "Today" };

/**
 * "/" is Today, the operational landing page — for anyone who may read at least
 * one of its panels (the API decides which ones they get). A role with none of
 * them, such as a pure merchandiser, is sent to the first section it can use,
 * as "/" always did; a role with nothing at all sees the calm no-access state.
 */
export default async function HomePage() {
  const user = await getCurrentStaffUser();
  const can = (permission: string) => (user ? hasPermission(user, permission) : false);
  if (todaySectionsFor(can).length > 0) return <TodayView />;

  const target = user ? firstPermittedRoute(can) : null;
  if (target) redirect(target);
  return <NoAccess title="Nothing here for your role yet" />;
}
