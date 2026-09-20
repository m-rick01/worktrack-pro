# WorkTrack Pro

A timesheet and employee-management app for Orthoclic: employees log daily hours
against task types, submit them for approval, and admins review, approve/reject,
and pull pay-cycle reports. Rebuilt from scratch (not extracted from Base44) so
it can be self-hosted and extended freely.

**Zero external dependencies.** The whole app — server and frontend — is plain
Node.js (built-in `http`, built-in SQLite via `node:sqlite`, built-in `crypto`
for password hashing, a hand-written SMTP client for email) plus a vanilla
HTML/CSS/JS frontend. There is nothing to `npm install` and no build step —
this was a deliberate choice to keep deployment on shared hosting (like
PlanetHoster) as simple as possible.

## Requirements

- Node.js 22.5 or newer (needs the built-in `node:sqlite` module — check your
  hosting panel's available Node versions).

## Local development

```bash
cp .env.example .env
# edit .env: leave BASE_PATH empty for local dev, fill in SMTP_* if you want
# real emails to send (otherwise they're just logged to the console)
# set MAIL_DRY_RUN=true to test approvals, invites and password resets without
# mailing anyone — every message is printed to the console instead, including
# the invite and reset links, so you can follow them without an inbox

node src/seed.js     # creates the first admin account + default task types
node src/server.js   # starts the app on http://localhost:3000
```

The seed script prints the admin email/password it created (from `ADMIN_EMAIL`
/ `ADMIN_PASSWORD` in `.env`, or sensible defaults). You'll be asked to set a
new password on first login.

## Before you deploy

- **Don't upload `data/` or `.env`.** The local database holds test accounts and
  practice entries, and the local `.env` points at a development machine.
  Production gets a fresh database from `src/seed.js` and its settings from the
  panel environment variables below.
- **`MAIL_DRY_RUN` must be false or unset.** Left at `true`, nobody receives an
  invite or a password reset and reset links are written to the server log.
- **`APP_URL` must be the real public URL.** Every invite and reset link is built
  from it; a stale value produces links that go nowhere.
- Serving over HTTPS also marks the session cookie `Secure`, which is derived
  from `APP_URL` starting with `https://`.

## Deploying on PlanetHoster (N0C panel)

**Check this first:** the app needs **Node 22.5 or newer** for the built-in
`node:sqlite` module. In the N0C panel, open **Langages → Node.js** and confirm
that version is offered. Nothing below 22.5 will start, and no amount of
configuration works around it — the database module simply isn't there.

`node:sqlite` shipped in 22.5 behind `--experimental-sqlite` and was only
unflagged in a later release, so on an early 22.x you must also set
`NODE_OPTIONS=--experimental-sqlite` (step 3). To find out which case you are in,
run this on the server with the version you intend to use:

```bash
node -e "require('node:sqlite'); console.log('available unflagged')"
```

If it prints the message, you don't need the flag. If it throws
`ERR_UNKNOWN_BUILTIN_MODULE`, you do — and the app says so on startup rather
than failing cryptically.

1. **Get the code onto the server**, into e.g. `/home/<user>/worktrack-pro`:
   - over SSH (N0C shows the host and port on its dashboard):
     `git clone https://github.com/m-rick01/worktrack-pro.git` — a private repo
     will ask for a GitHub username and a personal access token, not a password;
   - or upload the files through **Fichiers** (File Manager).
2. In the N0C panel, open **Langages → Node.js** and create the application:
   - **Node.js version**: 22.x or newer.
   - **Application mode**: Production.
   - **Application root**: the folder you uploaded to (e.g. `worktrack-pro`).
   - **Application URL**: `orthoclic.ca` with URI `/time` (or a subdomain
     if you'd rather have `time.orthoclic.ca`).
   - **Application startup file**: `src/server.js`.
3. Click **Create**, then open the **Environment variables** section for the
   application and set (mirroring `.env.example`):
   - `NODE_OPTIONS=--experimental-sqlite` — needed on a Node 22.x that still
     has `node:sqlite` behind the flag (see the version check above). Harmless
     to leave set on a newer runtime.
   - `BASE_PATH=/time` (must match the URI you chose above; leave empty
     if you used a subdomain instead of a subpath).
   - `APP_URL=https://orthoclic.ca/time` (used in emails).
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — use a
     mailbox on your domain (N0C → Messagerie) so account-invite and
     approval/rejection emails actually send.
   - `MAIL_DRY_RUN` — leave this **false or unset in production**. Set to `true`
     it stops all outgoing mail, so nobody would receive an invite or a password
     reset, and reset links would be written to the server log instead.
   - `DB_PATH` — optional, defaults to `./data/worktrack.db` inside the app
     folder; make sure that folder is writable (it is, by default, once the
     Node app is created).
   - There is no `npm install` step needed — the app has no dependencies — but
     the panel may still show an "npm install" button; running it is
     harmless (it will just report there's nothing to install).
4. Start (or restart) the application from the Node.js page.
5. Run the one-time seed **once**, over SSH (or the panel's run-script option):
   ```bash
   ADMIN_EMAIL=you@orthoclic.ca ADMIN_PASSWORD=some-strong-password node src/seed.js
   ```
   This creates your first admin account and the default task types. Do not
   run it again after that (it's safe to — it just skips creating a second
   admin — but it only needs to run once).
6. Visit `https://orthoclic.ca/time`, sign in with the admin account, and
   set a new password when prompted.

### Notes on file uploads and the database

Both the SQLite database (`data/worktrack.db`) and uploaded attachments
(`uploads/`) are plain files on disk under the app folder. Back these up
periodically (e.g. include them in your regular PlanetHoster backups) — there
is no external database server to separately manage.

### Changing the pay cycle, overtime rule, or notifications later

All of that is editable from the app itself once logged in as an admin, under
**Settings** — no code changes or redeploys needed for those.

## Project layout

```
src/
  server.js     HTTP server, routing, static file serving, subpath handling
  api.js        All /api/* route handlers
  db.js         SQLite schema + connection
  auth.js       Password hashing, sessions, cookies
  mail.js       Minimal hand-rolled SMTP client (no nodemailer dependency)
  utils.js      Pay-cycle math, overtime aggregation, CSV, body/multipart parsing
  pdf.js        Minimal hand-rolled PDF writer (no pdfkit dependency)
  report-pdf.js Lays out the Reports screen as a PDF, in English or French
  seed.js       One-time setup script (first admin account + default tasks)
  env.js        Tiny .env file loader
scripts/
  reset-password.js  Command-line password reset for a locked-out account
public/
  index.html, css/styles.css, js/app.js   The entire frontend (vanilla JS, no build step)
uploads/        Timesheet entry attachments (created automatically)
data/           SQLite database file (created automatically)
```

## What's implemented

- Email/password login; only admins can create accounts (Team → Invite Member),
  new accounts get emailed their temporary credentials + a login link.
- Self-serve password reset: "Forgot your password?" on the login screen emails a
  single-use link (in the employee's own language) that expires after 60 minutes.
  Only a SHA-256 of each token is stored, using it signs the account out of every
  other session, and the screen gives the same answer for every address so it
  can't be used to discover who has an account. Requires `APP_URL` to be set
  correctly — that's what the emailed link is built from.
- Employee: My Time (monthly calendar, new-entry modal with hours/task/notes/
  attachment), History (filterable past entries), Profile (self-editable
  contact info + language; job title/department are admin-managed).
- Entries move Draft → Pending → Approved/Rejected. Once reviewed, an entry is
  locked for the employee; only an admin can still edit it. Approvals/
  rejections email the employee.
- Admins don't log their own hours: they get Profile plus the admin screens, and
  sign in to the Approvals queue rather than a timesheet. My Time and History are
  employee-only, and an admin who follows one of those links lands on Approvals.
- Admin: Approvals queue, Reports (regular vs. overtime hours — overtime is
  anything past the configurable weekly threshold, default 40h, counted per
  employee — weekly chart, per-employee summary, CSV and PDF export), Team
  (member list + invite), Tasks (CRUD
  for task types like "Heures de travail" / "Congé Férié" / "Maladie"),
  Settings (pay cycle length + reference date with a live preview, overtime
  threshold, notification toggles, company name).

## What's intentionally out of scope

No data was migrated from the old Base44 app (per the original request, this
is a fresh start). If you later want to import historical timesheets, the
`time_entries` table in `data/worktrack.db` can be bulk-loaded directly — ask
and I can write an import script for whatever format the old data is in.
