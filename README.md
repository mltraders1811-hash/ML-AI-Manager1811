# M.L AI Manager

AI-powered collections & automation manager for Indian wholesalers who run
their business on **Vyapar**. V1 turns a daily Vyapar backup into a live
dashboard of who owes you money, with 1-click WhatsApp reminders and a
natural-language chat assistant over your own data.

## How it works

Vyapar's `.vyb` backup file is a plain ZIP archive containing a `.vyp`
SQLite database (unencrypted). Once a day, a scheduled job:

1. **Fetches** the newest `.vyb` from a Google Drive folder (via a service account).
2. **Unzips** it in memory to get the `.vyp` SQLite file.
3. **Reads** `kb_names` (customers), `kb_transactions` (invoices), `kb_lineitems`, and `kb_item` (inventory).
4. **Syncs** the normalized data into a multi-tenant Postgres database (idempotent upserts, safe to re-run).

The Next.js app reads from that Postgres database to power the dashboard,
WhatsApp reminder links, and the AI chat assistant.

```
Google Drive (.vyb)  --daily-->  GitHub Actions job  --sync-->  Postgres  <--read--  Next.js app (Vercel)
```

Deliberately split this way: the sync pipeline uses native/Node-only
packages (`better-sqlite3`, `adm-zip`, `googleapis`) that don't belong in a
Vercel serverless bundle, so it runs as a plain scheduled script instead.

## ⚠️ Before going live: verify the Vyapar column mapping

Vyapar's internal SQLite schema isn't publicly documented. `src/lib/sync/columnMap.ts`
has a best-effort mapping (with fallback candidates) based on the table
names in the product spec and common Vyapar conventions - **it has not been
verified against a real backup.**

Run this once you have a real `.vyb` file:

```bash
npm run inspect-vyp -- /path/to/your-backup.vyb
```

It prints every table, its columns, and a sample row. Compare that against
`src/lib/sync/columnMap.ts` and adjust the candidate column names (and the
`TXN_TYPE_MAP` codes) if anything doesn't match. The reader resolves columns
by fuzzy name matching, so small differences often self-correct - but the
`txn_type` code mapping (which numbers/strings mean "Sale" vs "Payment In"
etc.) is a guess worth double-checking specifically.

## $0-fixed-cost deployment

| Piece | Where | Cost |
| --- | --- | --- |
| Dashboard, API, AI chat | [Vercel](https://vercel.com) Hobby plan | Free |
| Database | [Neon](https://neon.tech) serverless Postgres, free tier | Free |
| Daily sync job | GitHub Actions scheduled workflow | Free |
| AI chat assistant | Anthropic API | **Pay-per-use** - fractions of a cent per question, not a subscription |

### 1. Database (Neon)

1. Create a free project at neon.tech, copy the connection string into `DATABASE_URL`.
2. Generate a tenant id: `node -e "console.log(crypto.randomUUID())"` → `DEFAULT_COMPANY_ID`.

That's it - the `build` script (`prisma db push && tsx prisma/seed.ts && next build`)
creates the schema and seeds the V1 company automatically on every Vercel
deploy, so there's no separate migration step to run by hand.

### 2. Google Drive access

1. Create a Google Cloud service account, download its JSON key.
2. Share your Vyapar backup folder in Drive with the service account's `client_email` (Viewer access).
3. Copy the folder's ID (from its URL) into `GDRIVE_BACKUP_FOLDER_ID`.
4. Put the full JSON key (as one line) into `GOOGLE_SERVICE_ACCOUNT_JSON`.

### 3. Admin passcode

```bash
node scripts/hash-passcode.mjs 1234        # pick your own passcode
```
Put the output into `ADMIN_PASSCODE_HASH`. Generate `SESSION_SECRET` with
`openssl rand -base64 32`.

### 4. Daily sync (GitHub Actions)

Push this repo to GitHub, then add these as **repository secrets**
(Settings → Secrets and variables → Actions):

- `DATABASE_URL`
- `DEFAULT_COMPANY_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GDRIVE_BACKUP_FOLDER_ID`

`.github/workflows/daily-sync.yml` runs it every day at 08:30 IST, and can
also be triggered manually from the Actions tab.

### 5. Dashboard (Vercel)

Import the repo into Vercel, set the same env vars (`DATABASE_URL`,
`DEFAULT_COMPANY_ID`, `ADMIN_PASSCODE_HASH`, `SESSION_SECRET`) plus
`ANTHROPIC_API_KEY` for the chat assistant. Deploy - that's it, no server to manage.

## Local development

```bash
npm install
cp .env.example .env   # fill in the values above
npx prisma db push
npm run db:seed
npm run dev
```

Run a sync manually against a real backup once Drive access is set up:

```bash
npm run sync
```

## Multi-tenancy

Every business table (`Customer`, `Invoice`, `InvoiceLineItem`,
`InventoryItem`, `SyncRun`) carries a `companyId` from day one. V1 hardcodes
a single `DEFAULT_COMPANY_ID`; adding real multi-tenancy later means adding
a `Company` selection layer on top, not a schema migration.

## What's intentionally not in V1

- No inventory UI (synced in the background for the AI assistant/future use, per spec).
- No WhatsApp Business API - reminders are `wa.me` deep links you tap to send yourself, matching the "1-click" spec exactly and keeping the cost at $0.
- No multi-user accounts - one shared admin passcode.
