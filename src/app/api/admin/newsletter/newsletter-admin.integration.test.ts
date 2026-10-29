import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { ActivityLogModel } from "src/server/core/activity-log.schema";
import { NewsletterSubscriberModel } from "src/server/newsletter/newsletter-subscriber.schema";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type RouteHandler } from "../test-support/admin-route-harness";

vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const list = (await import("./route")).GET as RouteHandler;
const unsubscribe = (await import("./[id]/unsubscribe/route")).PUT as RouteHandler;

const seed = (email: string, status: "SUBSCRIBED" | "UNSUBSCRIBED" = "SUBSCRIBED") => NewsletterSubscriberModel.create({ email, source: "footer", status, consentedAt: new Date() });
const wipe = () => Promise.all([NewsletterSubscriberModel.deleteMany({}), ActivityLogModel.deleteMany({}), removeHarnessStaff()]);

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await mongoose.disconnect();
});

describe("admin newsletter", () => {
  it("lists subscribers, filterable by status and searchable by address", async () => {
    await seed("a@example.com");
    await seed("b@example.com", "UNSUBSCRIBED");
    const owner = await signInAsOwner();
    expect((await (await owner.call(list, "/api/admin/newsletter")).json()).total).toBe(2);
    expect((await (await owner.call(list, "/api/admin/newsletter?status=UNSUBSCRIBED")).json()).data.map((s: { email: string }) => s.email)).toEqual(["b@example.com"]);
    expect((await (await owner.call(list, "/api/admin/newsletter?search=a@")).json()).data).toHaveLength(1);
  });

  it("unsubscribes an address, keeps the row as a suppression, audits it, and a repeat is harmless", async () => {
    const row = await seed("a@example.com");
    const owner = await signInAsOwner();
    const id = row._id.toString();
    const response = await owner.call(unsubscribe, `/api/admin/newsletter/${id}/unsubscribe`, { method: "PUT", params: { id } });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("UNSUBSCRIBED");
    const stored = await NewsletterSubscriberModel.findById(id).lean();
    expect(stored?.unsubscribedAt).toBeInstanceOf(Date);
    expect((await owner.call(unsubscribe, `/api/admin/newsletter/${id}/unsubscribe`, { method: "PUT", params: { id } })).status).toBe(200);
    expect(await ActivityLogModel.countDocuments({ entityType: "NewsletterSubscriber", action: "update" })).toBe(2);
    expect((await owner.call(unsubscribe, `/api/admin/newsletter/${new mongoose.Types.ObjectId()}/unsubscribe`, { method: "PUT", params: { id: new mongoose.Types.ObjectId().toString() } })).status).toBe(404);
  });

  it("negative: without NewsletterSubscriber.read the list is 403; read alone cannot unsubscribe", async () => {
    const row = await seed("a@example.com");
    const id = row._id.toString();
    const outsider = await signInWithPermissions([AppPermission.CUSTOMER.READ, AppPermission.REVIEW.READ]);
    expect((await outsider.call(list, "/api/admin/newsletter")).status).toBe(403);
    const reader = await signInWithPermissions([AppPermission.NEWSLETTER_SUBSCRIBER.READ]);
    expect((await reader.call(list, "/api/admin/newsletter")).status).toBe(200);
    expect((await reader.call(unsubscribe, `/api/admin/newsletter/${id}/unsubscribe`, { method: "PUT", params: { id } })).status).toBe(403);
    expect((await NewsletterSubscriberModel.findById(id).lean())?.status).toBe("SUBSCRIBED");
  });
});
