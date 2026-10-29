import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { signAuthToken } from "@kira-joo/backend-toolkit-next";
import { PermissionModel, RoleModel } from "src/server/core/authorization/role.model";
import { STAFF_SESSION_COOKIE } from "src/server/core/auth/staff-auth.constants";
import { StaffUserModel } from "src/server/identity/staff-user.schema";

/**
 * Calls admin route handlers the way Next does, as a signed-in Owner — the
 * real DTO validation, auth guard and response serialization, no HTTP server.
 *
 * The caller must mock `next/headers` (vi.mock is hoisted per test file, so
 * it cannot live here) with `cookies().get` reading `harnessCookieJar`, and
 * set `STAFF_JWT_SECRET` before importing any route module.
 */
export const harnessCookieJar = new Map<string, string>();

export type RouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

export interface AdminCaller {
  call(handler: RouteHandler, path: string, init?: { method?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string> }): Promise<Response>;
}

export async function signInAsOwner(): Promise<AdminCaller> {
  return signInWithRole({ grantsAll: true, permissionKeys: [] });
}

/** A staff member holding exactly these permission keys — for the negative case, which is the one that matters. */
export async function signInWithPermissions(permissionKeys: string[]): Promise<AdminCaller> {
  return signInWithRole({ grantsAll: false, permissionKeys });
}

async function signInWithRole({ grantsAll, permissionKeys }: { grantsAll: boolean; permissionKeys: string[] }): Promise<AdminCaller> {
  const permissions = await Promise.all(
    permissionKeys.map((key) => {
      const [entity = key, action = key] = key.split(".");
      return PermissionModel.findOneAndUpdate({ key }, { $setOnInsert: { key, entity, action, name: key, isSystem: false, isActive: true } }, { upsert: true, new: true });
    })
  );
  const role = await RoleModel.create({ name: `role-${new mongoose.Types.ObjectId()}`, grantsAll, permissions: permissions.map((permission) => permission._id), isActive: true });
  const staff = await StaffUserModel.create({ name: grantsAll ? "Owner" : "Staff", email: `staff-${new mongoose.Types.ObjectId()}@example.com`, roles: [role._id] });
  const token = await signAuthToken({ sub: staff._id.toString(), tokenVersion: staff.tokenVersion });
  harnessCookieJar.set(STAFF_SESSION_COOKIE, token);
  const cookie = `${STAFF_SESSION_COOKIE}=${token}`;

  return {
    call: (handler, path, init = {}) => {
      // A FormData body is sent as multipart: no JSON content-type, so the runtime sets the boundary itself (media uploads).
      const multipart = typeof FormData !== "undefined" && init.body instanceof FormData;
      return handler(
        new NextRequest(`http://localhost${path}`, {
          method: init.method ?? "GET",
          // Every admin money-moving write requires an Idempotency-Key; a fresh one per call, like the console, unless a test pins its own to exercise a replay.
          headers: { cookie, ...(multipart ? {} : { "content-type": "application/json" }), ...((init.method ?? "GET") === "GET" ? {} : { "Idempotency-Key": crypto.randomUUID() }), ...init.headers },
          body: init.body === undefined ? undefined : multipart ? (init.body as FormData) : JSON.stringify(init.body),
        }),
        { params: Promise.resolve(init.params ?? {}) }
      );
    },
  };
}

/** Other suites count every StaffUser and Role in the shared test database. */
export async function removeHarnessStaff() {
  await Promise.all([StaffUserModel.deleteMany({}), RoleModel.deleteMany({})]);
}
