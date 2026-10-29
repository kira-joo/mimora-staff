// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProfileModel } from "../../content/store-profile.schema";
import { CustomerModel } from "../../identity/customer.schema";
import { StaffUserModel } from "../../identity/staff-user.schema";
import { inviteStaff } from "../../admin/staff/invite-staff";
import { requestPasswordReset } from "../../shop/auth/forgot-password";
import { hashVerificationToken } from "../../shop/auth/hash-verification-token";
import { resendVerificationEmail } from "../../shop/auth/resend-verification";
import { connectToDatabase } from "../db/connect";
import { outboundNotifier } from "../notifications";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const sendSpy = vi.spyOn(outboundNotifier, "send");
const saved = { storefront: process.env.STOREFRONT_URL, backoffice: process.env.BACKOFFICE_URL };

beforeAll(async () => {
  await connectToDatabase();
  process.env.STOREFRONT_URL = "https://shop.example";
  process.env.BACKOFFICE_URL = "https://console.shop.example";
});
beforeEach(async () => {
  sendSpy.mockReset();
  sendSpy.mockResolvedValue(undefined);
  await StoreProfileModel.deleteMany({});
  await StoreProfileModel.create({
    name: { en: "Hirfa", ar: "حرفة" },
    tagline: { en: "x", ar: "x" },
    description: { en: "x", ar: "x" },
    contact: { phone: "+201000000000", email: "help@shop.example" },
    currency: "EGP",
    defaultLocale: "ar",
    supportedLocales: ["ar", "en"],
  });
});
afterEach(async () => {
  await Promise.all([CustomerModel.deleteMany({}), StaffUserModel.deleteMany({})]);
});
afterAll(async () => {
  await StoreProfileModel.deleteMany({});
  process.env.STOREFRONT_URL = saved.storefront;
  process.env.BACKOFFICE_URL = saved.backoffice;
  if (saved.storefront === undefined) delete process.env.STOREFRONT_URL;
  if (saved.backoffice === undefined) delete process.env.BACKOFFICE_URL;
  await mongoose.disconnect();
});

const tokenIn = (text: string) => new URL(/https:\/\/\S+/.exec(text)![0]).searchParams.get("token")!;

describe("account emails carry a link, not a bare token", () => {
  it("verification: a /ar/verify-email?token= link whose token is the one stored (hashed), nothing secret in the subject", async () => {
    const email = `c-${Math.floor(Math.random() * 1e9)}@example.com`;
    const customer = await CustomerModel.create({ phone: `+2010${Math.floor(Math.random() * 1e8)}`, email, passwordHash: "x", name: "Test" });
    await resendVerificationEmail(email);

    const sent = sendSpy.mock.calls[0]![0];
    expect(sent).toMatchObject({ channel: "EMAIL", to: email, template: "verify-email" });
    expect(sent.body).toContain("https://shop.example/ar/verify-email?token=");
    const token = tokenIn(sent.body);
    expect(sent.subject).not.toContain(token);
    expect(sent.subject).toContain("حرفة"); // the store profile's default locale (ar) and the store name in it
    expect(sent.html).toContain('dir="rtl"');
    const stored = await CustomerModel.findById(customer._id).select("+emailVerificationTokenHash").lean();
    expect(stored?.emailVerificationTokenHash).toBe(hashVerificationToken(token));
  });

  it("password reset by email: a /ar/reset-password?token= link; by phone-only: an SMS carrying the link alone", async () => {
    const email = `c-${Math.floor(Math.random() * 1e9)}@example.com`;
    await CustomerModel.create({ phone: `+2010${Math.floor(Math.random() * 1e8)}`, email, passwordHash: "x", name: "Test" });
    await requestPasswordReset(email);
    const mail = sendSpy.mock.calls[0]![0];
    expect(mail).toMatchObject({ channel: "EMAIL", template: "password-reset" });
    expect(mail.body).toContain("https://shop.example/ar/reset-password?token=");
    expect(mail.subject).not.toContain(tokenIn(mail.body));

    const phone = `+2011${Math.floor(Math.random() * 1e8)}`;
    await CustomerModel.create({ phone, passwordHash: "x", name: "Phone only" });
    await requestPasswordReset(phone);
    const sms = sendSpy.mock.calls[1]![0];
    expect(sms).toMatchObject({ channel: "SMS", to: phone });
    expect(sms.body).toMatch(/^https:\/\/shop\.example\/ar\/reset-password\?token=/);
  });

  it("staff invitation: an English /accept-invite?token= link on the console's origin", async () => {
    const staff = await inviteStaff({ name: "Alice", email: "alice@example.com" });
    const sent = sendSpy.mock.calls[0]![0];
    expect(sent).toMatchObject({ channel: "EMAIL", to: "alice@example.com", template: "staff-invitation" });
    expect(sent.body).toContain("https://console.shop.example/accept-invite?token=");
    expect(tokenIn(sent.body)).toBe(staff.invitation.token);
    expect(sent.subject).not.toContain(staff.invitation.token);
    expect(sent.html).toContain('lang="en"');
  });

  it("a failing mail path never fails the flow: the token is still minted and the call resolves", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    sendSpy.mockRejectedValue(new Error("smtp down"));
    const email = `c-${Math.floor(Math.random() * 1e9)}@example.com`;
    const customer = await CustomerModel.create({ phone: `+2010${Math.floor(Math.random() * 1e8)}`, email, passwordHash: "x", name: "Test" });
    await expect(resendVerificationEmail(email)).resolves.toBeUndefined();
    const stored = await CustomerModel.findById(customer._id).select("+emailVerificationTokenHash").lean();
    expect(stored?.emailVerificationTokenHash).toBeTruthy();
  });
});
