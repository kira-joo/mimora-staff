import { PermissionGuard } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { Metadata } from "next";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { NoAccess } from "src/components/no-access";
import { StoreProfileView } from "src/features/settings/store-profile-view";

export const metadata: Metadata = { title: "Store profile" };

export default function StoreSettingsPage() {
  return (
    <PermissionGuard permission={AppPermission.STORE_PROFILE.READ} fallback={<NoAccess />}>
      <StoreProfileView />
    </PermissionGuard>
  );
}
