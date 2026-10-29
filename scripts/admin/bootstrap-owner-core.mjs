// The first Owner, created the one safe way there is: as a pending invitation, completed by the owner
// themselves through the backoffice's existing /accept-invite page. No password ever passes through this
// script, the code it prints is single-use and expires in an hour, and only its SHA-256 hash is stored —
// exactly what `inviteStaff` (src/server/admin/staff/invite-staff.ts) stores for any invited staff member.
//
// Plain .mjs on the MongoDB driver (no TypeScript runtime in production images); the few values it shares
// with the application are pinned by bootstrap-owner.integration.test.ts so they cannot drift.
import { createHash, randomBytes } from "node:crypto";

/** = STAFF_INVITE_TOKEN_TTL_MS (src/server/core/auth/staff-auth.constants.ts). */
export const INVITE_TTL_MS = 60 * 60 * 1000;
/** Mongoose's collection names for StaffUser, Role and ActivityLog. */
export const COLLECTIONS = { staff: "staffusers", roles: "roles", activity: "activitylogs" };
/** Script-only, outside every application schema: the document concurrent bootstraps serialise on. */
export const LOCK_COLLECTION = "bootstraplocks";
export const OWNER_ROLE = "Owner";

/** = hashVerificationToken (src/server/shop/auth/hash-verification-token.ts). */
export const hashInviteToken = (token) => createHash("sha256").update(token).digest("hex");
export const mintInviteToken = () => randomBytes(32).toString("base64url");

export class BootstrapRefusal extends Error {}

const FLAGS = new Set(["dry-run", "reissue"]);
const VALUED = new Set(["email", "name", "confirm-production", "backoffice-url"]);

/**
 * `--key value` and `--key=value` both work (the usage line shows the first); `--dry-run` and
 * `--reissue` are bare flags. Anything unknown is refused rather than ignored — a mistyped
 * `--confirm-producton` must not silently mean "not confirmed, carry on".
 */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) throw new BootstrapRefusal(`Unexpected argument "${raw}".`);
    const [key, inline] = raw.slice(2).split(/=(.*)/s);
    if (FLAGS.has(key)) {
      if (inline !== undefined) throw new BootstrapRefusal(`--${key} takes no value.`);
      args[key] = true;
    } else if (VALUED.has(key)) {
      const value = inline !== undefined ? inline : argv[++i];
      if (value === undefined || value.startsWith("--")) throw new BootstrapRefusal(`--${key} needs a value.`);
      args[key] = value;
    } else {
      throw new BootstrapRefusal(`Unknown option --${key}.`);
    }
  }
  return args;
}

/**
 * Is this a local development/test database, or something else (assume production)? Local means every
 * host is localhost AND the database name is one of the workspace's dev/test/fixture names — the same
 * rule as scripts/fixtures/seed-store.mjs. Anything else needs the operator to type the database name.
 */
export function describeTarget(uri, dbName) {
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri ?? "");
  if (!m) throw new BootstrapRefusal("MONGODB_URI is not a mongodb:// or mongodb+srv:// URI.");
  if (!dbName) throw new BootstrapRefusal("MONGODB_DB is required — the bootstrap never guesses which database to write.");
  const srv = uri.startsWith("mongodb+srv://");
  const hosts = m[1].split(",").map((h) => h.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase());
  const localHosts = !srv && hosts.every((h) => ["localhost", "127.0.0.1", "::1"].includes(h));
  const devName = dbName.endsWith("-dev") || dbName.endsWith("-test") || dbName.startsWith("store-fixture-");
  return { local: localHosts && devName, hosts, dbName };
}

/** The confirmation rule, separate so it is testable: a non-local target needs --confirm-production=<exact db name>. */
export function assertConfirmed(target, confirmation) {
  if (target.local) return;
  if (confirmation !== target.dbName) {
    throw new BootstrapRefusal(
      `This is not a local dev/test database (hosts: ${target.hosts.join(", ")}, database: ${target.dbName}). ` +
        `Re-run with --confirm-production=${target.dbName} to confirm you mean it.`
    );
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Creates the first Owner as a pending invitation, or (with `reissue`) re-mints the code for a pending
 * Owner that never activated. Runs in ONE transaction that first increments a lock document: two
 * concurrent bootstraps therefore write-conflict, the driver retries the loser, and the retry sees the
 * winner's Owner and refuses. Returns the plaintext code for the operator; nothing else ever sees it.
 */
export async function bootstrapOwner(client, db, { email, name, reissue = false, dryRun = false, now = new Date(), mintToken = mintInviteToken }) {
  const normalisedEmail = String(email ?? "").toLowerCase().trim();
  if (!EMAIL.test(normalisedEmail)) throw new BootstrapRefusal("--email must be a valid email address.");
  const ownerName = String(name ?? "").trim() || "Owner";

  const session = client.startSession();
  let outcome;
  try {
    await session.withTransaction(async () => {
      const roles = db.collection(COLLECTIONS.roles);
      const staff = db.collection(COLLECTIONS.staff);
      const ownerRole = await roles.findOne({ name: OWNER_ROLE }, { session });
      if (!ownerRole) {
        throw new BootstrapRefusal("No Owner role in this database. Start the backend against it once first — it seeds the default roles at boot.");
      }
      // The serialisation point: every bootstrap WRITES this one document before deciding anything, so two
      // concurrent runs always write-conflict and the loser re-runs after the winner commits. It must be a
      // write that always changes the document — an update setting a value it already holds is a no-op to
      // MongoDB, takes no write, and serialises nothing (measured: 3 of 3 concurrent runs created Owners).
      if (!dryRun) {
        await db.collection(LOCK_COLLECTION).updateOne({ _id: "first-owner" }, { $inc: { attempts: 1 }, $set: { lastAttemptAt: now } }, { upsert: true, session });
      }

      const owners = await staff.find({ roles: ownerRole._id }, { session, projection: { email: 1, passwordHash: 1 } }).toArray();
      const token = mintToken();
      const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

      if (reissue) {
        const pending = owners.find((o) => o.email === normalisedEmail);
        if (!pending) throw new BootstrapRefusal(`No Owner with the email ${normalisedEmail} exists to re-issue a code for.`);
        if (pending.passwordHash) throw new BootstrapRefusal("That Owner has already activated their account; re-issuing would become a password reset. Use the backoffice instead.");
        if (!dryRun) {
          await staff.updateOne({ _id: pending._id, passwordHash: { $exists: false } }, { $set: { passwordResetTokenHash: hashInviteToken(token), passwordResetExpiresAt: expiresAt, updatedAt: now } }, { session });
          await audit(db, session, pending._id, "reissue-owner-invitation", normalisedEmail, now);
        }
        outcome = { action: "reissued", staffId: pending._id, email: normalisedEmail, token, expiresAt };
        return;
      }

      if (owners.length > 0) {
        throw new BootstrapRefusal(
          `An Owner already exists (${owners.length}). Invite further staff from the backoffice; to replace an un-activated Owner's expired code use --reissue.`
        );
      }
      if (await staff.findOne({ email: normalisedEmail }, { session, projection: { _id: 1 } })) {
        throw new BootstrapRefusal(`A staff member with the email ${normalisedEmail} already exists.`);
      }
      if (dryRun) {
        outcome = { action: "would-create", email: normalisedEmail, expiresAt };
        return;
      }
      // The same fields inviteStaff writes, plus the schema defaults Mongoose would have applied.
      const { insertedId } = await staff.insertOne(
        {
          email: normalisedEmail,
          name: ownerName,
          roles: [ownerRole._id],
          active: true,
          tokenVersion: 1,
          passwordResetTokenHash: hashInviteToken(token),
          passwordResetExpiresAt: expiresAt,
          createdAt: now,
          updatedAt: now,
        },
        { session }
      );
      await audit(db, session, insertedId, "bootstrap-owner", normalisedEmail, now);
      outcome = { action: "created", staffId: insertedId, email: normalisedEmail, token, expiresAt };
    });
  } finally {
    await session.endSession();
  }
  return outcome;
}

/** The activity log needs a staff actor; the bootstrapped Owner is its own. Never the token. */
async function audit(db, session, staffId, action, email, now) {
  await db.collection(COLLECTIONS.activity).insertOne(
    { actorId: staffId, action, entityType: "StaffUser", entityId: staffId, changes: { email, via: "scripts/admin/bootstrap-owner.mjs" }, createdAt: now, updatedAt: now },
    { session }
  );
}
