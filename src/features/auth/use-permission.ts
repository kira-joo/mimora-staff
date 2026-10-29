"use client";

import { hasPermission, useAuthUserContext } from "@kira-joo/frontend-toolkit-core";
import { useCallback } from "react";

/**
 * `can(permission)` for the signed-in staff member — hides UI only. The API
 * route behind every action checks the same permission server-side.
 */
export function usePermission(): (permission: string) => boolean {
  const user = useAuthUserContext();
  return useCallback((permission: string) => (user ? hasPermission(user, permission) : false), [user]);
}
