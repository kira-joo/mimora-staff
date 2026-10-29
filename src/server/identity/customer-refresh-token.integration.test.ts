// @vitest-environment node
import { issueRefreshToken, revokeAllForSubject, revokeToken, rotateRefreshToken } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { CustomerRefreshTokenModel } from "./customer-refresh-token.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const TTL_MS = 60 * 60 * 1000;

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await CustomerRefreshTokenModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

/**
 * `CustomerRefreshTokenModel` is `createRefreshTokenSchema()` with no
 * audience field (D-14) — this exercises the toolkit's own rotation/reuse/
 * revocation logic through this app's actual collection, the thing `login`/
 * `refresh`/`logout`/`resetPassword` all depend on for the auth-lifecycle
 * behavior a cookie-scope test cannot reach (see `login.integration.test.ts`'s
 * doc comment on why the cookie-writing wrapper itself is verified live).
 */
describe("customer refresh token lifecycle", () => {
  it("rotates a valid token into a new one in the same family", async () => {
    const subjectId = new mongoose.Types.ObjectId();
    const issued = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId, ttlMs: TTL_MS });

    const rotated = await rotateRefreshToken(CustomerRefreshTokenModel, issued.token, TTL_MS);

    expect(rotated.subjectId.toString()).toBe(subjectId.toString());
    expect(rotated.issued.familyId).toBe(issued.familyId);
    expect(rotated.issued.token).not.toBe(issued.token);
  });

  it("presenting an already-rotated token is reuse — it revokes the WHOLE family, including the currently-active token", async () => {
    const subjectId = new mongoose.Types.ObjectId();
    const issued = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId, ttlMs: TTL_MS });
    const rotated = await rotateRefreshToken(CustomerRefreshTokenModel, issued.token, TTL_MS);

    // The old, already-rotated token is presented again (e.g. a stolen copy).
    await expect(rotateRefreshToken(CustomerRefreshTokenModel, issued.token, TTL_MS)).rejects.toThrow();

    // The legitimate holder's NEWEST token is now revoked too — refusing the
    // thief alone would leave the victim's own session usable, which is not
    // "signed out," it's "still logged in with a compromised session."
    await expect(rotateRefreshToken(CustomerRefreshTokenModel, rotated.issued.token, TTL_MS)).rejects.toThrow();
  });

  it("rejects an unknown token", async () => {
    await expect(rotateRefreshToken(CustomerRefreshTokenModel, "not-a-real-token", TTL_MS)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const subjectId = new mongoose.Types.ObjectId();
    const issued = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId, ttlMs: -1000 });

    await expect(rotateRefreshToken(CustomerRefreshTokenModel, issued.token, TTL_MS)).rejects.toThrow();
  });

  it("revokeToken (logout) ends only that device's family, not a sibling session for the same customer", async () => {
    const subjectId = new mongoose.Types.ObjectId();
    const deviceA = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId, ttlMs: TTL_MS });
    const deviceB = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId, ttlMs: TTL_MS });

    await revokeToken(CustomerRefreshTokenModel, deviceA.token);

    await expect(rotateRefreshToken(CustomerRefreshTokenModel, deviceA.token, TTL_MS)).rejects.toThrow();
    await expect(rotateRefreshToken(CustomerRefreshTokenModel, deviceB.token, TTL_MS)).resolves.toBeDefined();
  });

  it("revokeAllForSubject (password reset) ends EVERY device's session", async () => {
    const subjectId = new mongoose.Types.ObjectId();
    const deviceA = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId, ttlMs: TTL_MS });
    const deviceB = await issueRefreshToken({ model: CustomerRefreshTokenModel, subjectId, ttlMs: TTL_MS });

    await revokeAllForSubject(CustomerRefreshTokenModel, subjectId);

    await expect(rotateRefreshToken(CustomerRefreshTokenModel, deviceA.token, TTL_MS)).rejects.toThrow();
    await expect(rotateRefreshToken(CustomerRefreshTokenModel, deviceB.token, TTL_MS)).rejects.toThrow();
  });

  it("logout with no presented token is a harmless no-op, never a throw", async () => {
    await expect(revokeToken(CustomerRefreshTokenModel, "not-a-real-token")).resolves.toBeUndefined();
  });
});
