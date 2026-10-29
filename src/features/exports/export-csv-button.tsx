"use client";

import { CustomButton, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { Download } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ExportKind } from "src/api/exports.endpoints";
import { usePermission } from "src/features/auth/use-permission";
import { exportUrl, filenameFrom } from "./export-url";

/**
 * Downloads the list the staff member is looking at as a CSV — every row matching
 * the current filters, not the visible page. Shown only with BOTH permissions the
 * API requires (the list's read and the export); the API checks them again.
 * The file is fetched (not navigated to) so a refusal or an expired session is a
 * message here, not a JSON error saved as "orders.csv".
 */
export function ExportCsvButton({ kind, readPermission, exportPermission, label }: { kind: ExportKind; readPermission: string; exportPermission: string; label: string }) {
  const can = usePermission();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  if (!can(readPermission) || !can(exportPermission)) return null;

  async function download() {
    setBusy(true);
    try {
      const response = await fetch(exportUrl(kind, params), { credentials: "same-origin", headers: { Accept: "text/csv" } });
      if (!response.ok) {
        toast.error(response.status === 401 ? "Your session has expired. Reload the page and sign in again." : response.status === 403 ? "You don't have permission to export this." : "The export failed. Try again.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFrom(response.headers.get("content-disposition"), `${kind}.csv`);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error("The export failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CustomButton variant="outline" onClick={download} loading={busy} disabled={busy} leftIcon={Download}>
      {label}
    </CustomButton>
  );
}
