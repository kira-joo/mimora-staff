# Admin scripts

- `adopt-store-identity.mjs` — mark a database as belonging to one store (below). Run once per database, before its first boot.
- `bootstrap-owner.mjs` — create the store's first Owner.

## Store identity (`adopt-store-identity.mjs`)

One deployment serves one store, and two deployments pointed at one database would silently merge their data. The
backend therefore refuses to start unless the database holds a marker (`storeidentity`, `_id: "store-identity"`,
`storeId`, `adoptedAt`, `adoptedVia`) naming the deployment's `STORE_ID`. This command is the **only** writer of that marker.

```bash
# 1. Dry run: prints the preflight and writes nothing.
MONGODB_URI='<uri>' MONGODB_DB=<db> node scripts/admin/adopt-store-identity.mjs --store-id mimora --confirm-db <db> --dry-run
# 2. Check the preflight is the store you mean, then adopt.
MONGODB_URI='<uri>' MONGODB_DB=<db> node scripts/admin/adopt-store-identity.mjs --store-id mimora --confirm-db <db>
```

Exit 0: adopted, or already adopted as the same store (nothing changed). Exit 1: `refused: <reason>`, nothing written.

What it guarantees (each covered by `src/server/core/db/store-identity.integration.test.ts`):

- **You see whose data it is first.** Before anything is written it prints the database name and hosts (never the
  credentials), whether a marker exists and which store it names, the store profile's English and Arabic name and
  currency, and the product, order and customer counts. A real run prints the same.
- **Typed confirmation, always.** `--confirm-db` must equal `MONGODB_DB` exactly, for a local database as much as for
  production. `--store-id` must be a valid slug (1-40 lowercase letters, digits, hyphens). An unknown or mistyped
  option is refused, never ignored.
- **Atomic, and never an overwrite.** One insert-if-absent (`$setOnInsert` upsert on the fixed `_id`), a duplicate-key
  error from a concurrent run treated as "someone else inserted", then the marker is **read back**: the same store id is
  success, a different one is refused. N concurrent runs with one id produce one marker and all succeed; with different ids
  exactly one wins and the rest are refused. Repeating a run changes nothing (`adoptedAt` stays).
- **Touches nothing else.** It reads `storeprofiles`, `products`, `orders` and `customers` for the preflight and writes
  only the marker. Existing data is unchanged.
- **Not audited in `activitylogs`.** An entry needs a staff actor (`actorId` is required and there is none at adoption
  time, unlike `bootstrap-owner`, where the new Owner is its own actor). The marker's own `adoptedAt` and `adoptedVia`
  are the record.

Rename a store only by editing the marker by hand, deliberately, together with `STORE_ID` on both deployments; this
command never changes an existing marker. Procedure and refusals: `docs/deployment.md` → Store identity.

## First Owner bootstrap (`bootstrap-owner.mjs`)

A new deployment has no staff account, and the backoffice only lets an existing Owner invite staff. This script
creates the **first** Owner as a **pending invitation**. It does not set a password. It writes the same fields
`inviteStaff` writes (`src/server/admin/staff/invite-staff.ts`) and prints a single-use code that expires after one
hour. The Owner enters that code on the backoffice's `/accept-invite` page and chooses a password there, using the same
page and `acceptStaffInvite` path as every invited staff member.

What it guarantees (each covered by `src/server/admin/staff/bootstrap-owner.integration.test.ts`):

- **Only the first Owner.** It refuses if any Owner already exists, or if a staff member already has that email. Every
  later account is invited from the backoffice.
- **No password and no stored secret.** Only the code's SHA-256 hash is stored. The code itself is printed once to the
  terminal that ran the script. It is not logged, written to the audit trail or stored anywhere else.
- **Single-use and short-lived.** Accepting the code clears it, and after one hour it is refused.
- **Safe to run concurrently.** Each run is one transaction that first writes a lock document (`bootstraplocks`), so two
  operators running the script at the same moment produce exactly one Owner. The loser is refused.
- **Audited.** An `activitylogs` entry (`bootstrap-owner` / `reissue-owner-invitation`) records the email and the script.
- **Production needs typed confirmation.** A target counts as local only when every host is localhost and the database
  name ends in `-dev`/`-test` or starts with `store-fixture-`. Anything else is refused unless
  `--confirm-production=<the exact MONGODB_DB>` is given. An unknown or mistyped option is refused, never ignored.

### Prerequisite

The database must already be adopted (`adopt-store-identity.mjs`, above: the backend will not boot against an unmarked
database) and contain the default roles. Start the backend against it once, because it seeds the roles at boot. Without the roles the script refuses with a message that says so.

### Procedure

```bash
# 1. Dry run: checks everything and writes nothing.
MONGODB_URI='<uri>' MONGODB_DB=<db> node scripts/admin/bootstrap-owner.mjs \
  --email owner@example.com --name "Owner Name" --dry-run [--confirm-production=<db>]

# 2. Create the Owner. The code is printed once.
MONGODB_URI='<uri>' MONGODB_DB=<db> node scripts/admin/bootstrap-owner.mjs \
  --email owner@example.com --name "Owner Name" --backoffice-url=https://admin.example.com [--confirm-production=<db>]
```

Both `--key value` and `--key=value` work. Run it from a machine you control, and don't put the URI in shell history
when you can avoid it (prefix the command with a space if `HISTCONTROL=ignorespace`, or export the variables from a
password manager). The code grants the Owner role to whoever enters it first, so hand it to the Owner over a channel
you trust. Do not send it in a ticket, a chat channel or a screenshot.

### If the code expires before it is used

```bash
MONGODB_URI='<uri>' MONGODB_DB=<db> node scripts/admin/bootstrap-owner.mjs --email owner@example.com --reissue [--confirm-production=<db>]
```

This prints a new code and kills the old one. It works only for an Owner who has **not** activated. Once a password is
set, `--reissue` is refused, because re-issuing would then amount to a password reset done outside the application.

### What it does not do

- It does not send email, on purpose. The backend does send a staff-invitation email when mail is configured
  (`SMTP_*` and `MAIL_FROM` — see `docs/deployment.md`), but only for staff invited from the backoffice. This script runs
  on the operator's machine, not the server, and the first Owner has to be creatable with mail OFF (a new deployment
  usually has none yet), so it always prints the code on the terminal and the operator delivers it by hand. Nothing
  about the script depends on, or changes with, whether mail is configured.
- It does not create a second Owner or promote an existing user. Do those in the backoffice.
- It has no `package.json` script, so it cannot run by accident from a lifecycle hook.
