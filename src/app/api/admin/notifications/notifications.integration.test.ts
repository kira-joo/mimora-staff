import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { ActivityLogModel } from "src/server/core/activity-log.schema";
import { StaffNotificationModel } from "src/server/notifications/staff-notification.schema";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type RouteHandler } from "../test-support/admin-route-harness";

vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const list = (await import("./route")).GET as RouteHandler;
const unreadCount = (await import("./unread-count/route")).GET as RouteHandler;
const readAll = (await import("./read-all/route")).PUT as RouteHandler;
const readOne = (await import("./[id]/read/route")).PUT as RouteHandler;

const entity = () => new mongoose.Types.ObjectId();
const seed = (type: "NEW_ORDER" | "PAYMENT_PROOF_SUBMITTED" | "RETURN_REQUESTED" | "LOW_STOCK", title: string, offset = 0) =>
  StaffNotificationModel.create({ type, title, link: "/orders/x", entityType: "Order", entityId: entity(), readBy: [], at: new Date(Date.now() - offset) });

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  await Promise.all([StaffNotificationModel.deleteMany({}), ActivityLogModel.deleteMany({}), removeHarnessStaff()]);
});
afterAll(async () => {
  await Promise.all([StaffNotificationModel.deleteMany({}), removeHarnessStaff()]);
  await mongoose.disconnect();
});

describe("staff notifications API — permissions, the negative cases", () => {
  it.each([
    ["list", () => list, "/api/admin/notifications", "GET"],
    ["unread count", () => unreadCount, "/api/admin/notifications/unread-count", "GET"],
    ["mark all read", () => readAll, "/api/admin/notifications/read-all", "PUT"],
  ] as const)("%s: a staff member without Notification.read is refused (403)", async (_label, handler, path, method) => {
    await seed("NEW_ORDER", "New order A");
    const staff = await signInWithPermissions([AppPermission.ORDER.READ, CustomPermission.PAYMENT_VERIFY, AppPermission.VARIANT.READ]);
    const response = await staff.call(handler(), path, { method, ...(method === "PUT" ? { body: {} } : {}) });
    expect(response.status).toBe(403);
  });

  it("mark one read: refused (403) without Notification.read, and nothing changes", async () => {
    const n = await seed("NEW_ORDER", "New order A");
    const staff = await signInWithPermissions([AppPermission.ORDER.READ]);
    const response = await staff.call(readOne, `/api/admin/notifications/${n._id}/read`, { method: "PUT", body: {}, params: { id: n._id.toString() } });
    expect(response.status).toBe(403);
    expect((await StaffNotificationModel.findById(n._id).lean())?.readBy).toHaveLength(0);
  });

  it("no session at all: 401", async () => {
    const { NextRequest } = await import("next/server");
    const { harnessCookieJar } = await import("../test-support/admin-route-harness");
    harnessCookieJar.clear();
    const response = await list(new NextRequest("http://localhost/api/admin/notifications"), { params: Promise.resolve({}) });
    expect(response.status).toBe(401);
  });

  it("Notification.read alone sees NOTHING: each kind needs the permission on the record it announces", async () => {
    await Promise.all([seed("NEW_ORDER", "o"), seed("PAYMENT_PROOF_SUBMITTED", "p"), seed("RETURN_REQUESTED", "r"), seed("LOW_STOCK", "s")]);
    const staff = await signInWithPermissions([CustomPermission.NOTIFICATION_READ]);
    const body = await (await staff.call(list, "/api/admin/notifications")).json();
    expect(body.data).toEqual([]);
    expect((await (await staff.call(unreadCount, "/api/admin/notifications/unread-count")).json()).unread).toBe(0);
  });

  it("a feed is filtered per kind: Order.read sees new-order notices, not payment proofs, returns or stock", async () => {
    await Promise.all([seed("NEW_ORDER", "o"), seed("PAYMENT_PROOF_SUBMITTED", "p"), seed("RETURN_REQUESTED", "r"), seed("LOW_STOCK", "s")]);
    const staff = await signInWithPermissions([CustomPermission.NOTIFICATION_READ, AppPermission.ORDER.READ]);
    const body = await (await staff.call(list, "/api/admin/notifications")).json();
    expect(body.data.map((n: { type: string }) => n.type)).toEqual(["NEW_ORDER"]);
    expect(body.total).toBe(1);
    expect((await (await staff.call(unreadCount, "/api/admin/notifications/unread-count")).json()).unread).toBe(1);
  });

  it("a notification the caller may not see cannot be marked read — 404, and it is untouched", async () => {
    const payment = await seed("PAYMENT_PROOF_SUBMITTED", "p");
    const staff = await signInWithPermissions([CustomPermission.NOTIFICATION_READ, AppPermission.ORDER.READ]);
    const response = await staff.call(readOne, `/api/admin/notifications/${payment._id}/read`, { method: "PUT", body: {}, params: { id: payment._id.toString() } });
    expect(response.status).toBe(404);
    expect((await StaffNotificationModel.findById(payment._id).lean())?.readBy).toHaveLength(0);
  });

  it("mark-all-read leaves unseen kinds unread for the people who can see them", async () => {
    await Promise.all([seed("NEW_ORDER", "o"), seed("PAYMENT_PROOF_SUBMITTED", "p")]);
    const orderOnly = await signInWithPermissions([CustomPermission.NOTIFICATION_READ, AppPermission.ORDER.READ]);
    expect((await (await orderOnly.call(readAll, "/api/admin/notifications/read-all", { method: "PUT", body: {} })).json()).marked).toBe(1);
    const payer = await signInWithPermissions([CustomPermission.NOTIFICATION_READ, CustomPermission.PAYMENT_VERIFY]);
    expect((await (await payer.call(unreadCount, "/api/admin/notifications/unread-count")).json()).unread).toBe(1);
  });
});

describe("staff notifications API — behaviour", () => {
  it("lists newest first, paginated, with the caller's own read state", async () => {
    await seed("NEW_ORDER", "oldest", 3000);
    await seed("NEW_ORDER", "middle", 2000);
    await seed("NEW_ORDER", "newest", 1000);
    const owner = await signInAsOwner();
    const page1 = await (await owner.call(list, "/api/admin/notifications?page=1&limit=2")).json();
    expect(page1.data.map((n: { title: string }) => n.title)).toEqual(["newest", "middle"]);
    expect(page1.total).toBe(3);
    const page2 = await (await owner.call(list, "/api/admin/notifications?page=2&limit=2")).json();
    expect(page2.data.map((n: { title: string }) => n.title)).toEqual(["oldest"]);
    expect(page1.data.every((n: { read: boolean }) => n.read === false)).toBe(true);
  });

  it("read state is per staff member: one person clearing their bell does not clear a colleague's", async () => {
    const n = await seed("NEW_ORDER", "o");
    await seed("NEW_ORDER", "o2");
    const alice = await signInAsOwner();
    expect((await (await alice.call(unreadCount, "/api/admin/notifications/unread-count")).json()).unread).toBe(2);
    expect((await alice.call(readOne, `/api/admin/notifications/${n._id}/read`, { method: "PUT", body: {}, params: { id: n._id.toString() } })).status).toBe(200);
    expect((await (await alice.call(unreadCount, "/api/admin/notifications/unread-count")).json()).unread).toBe(1);
    const unreadOnly = await (await alice.call(list, "/api/admin/notifications?unread=true")).json();
    expect(unreadOnly.data).toHaveLength(1);

    const bob = await signInAsOwner();
    expect((await (await bob.call(unreadCount, "/api/admin/notifications/unread-count")).json()).unread).toBe(2);
    await bob.call(readAll, "/api/admin/notifications/read-all", { method: "PUT", body: {} });
    expect((await (await bob.call(unreadCount, "/api/admin/notifications/unread-count")).json()).unread).toBe(0);
  });

  it("marking read is idempotent (no duplicate reader) and leaves no audit-log row", async () => {
    const n = await seed("NEW_ORDER", "o");
    const owner = await signInAsOwner();
    for (let i = 0; i < 2; i += 1) await owner.call(readOne, `/api/admin/notifications/${n._id}/read`, { method: "PUT", body: {}, params: { id: n._id.toString() } });
    await owner.call(readAll, "/api/admin/notifications/read-all", { method: "PUT", body: {} });
    expect((await StaffNotificationModel.findById(n._id).lean())?.readBy).toHaveLength(1);
    expect(await ActivityLogModel.countDocuments({})).toBe(0);
  });

  it("rejects a malformed id (400), not a crash", async () => {
    const owner = await signInAsOwner();
    expect((await owner.call(readOne, "/api/admin/notifications/nope/read", { method: "PUT", body: {}, params: { id: "nope" } })).status).toBe(400);
  });
});
