import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { ThemeView } from "src/features/settings/theme-view";

export const metadata: Metadata = { title: "Theme" };

export default function ThemeSettingsPage() {
  return (
    <PermissionGuard permission={AppPermission.STORE_PROFILE.READ} fallback={<NoAccess />}>
      <ThemeView />
    </PermissionGuard>
  );
}
