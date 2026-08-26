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
3. **Reads** `kb_names` (customers, joined to `kb_party_groups` for broker
   attribution - see Brokerage below), `kb_transactions` (invoices),
   `kb_lineitems` (joined to `kb_items` for item names), and `kb_item`
   (inventory).
4. **Syncs** the normalized data into a multi-tenant Postgres database (idempotent upserts, safe to re-run).

The Next.js app reads from that Postgres database to power the dashboard,
WhatsApp reminder links, and the AI chat assistant.

## Brokerage tracking (`/brokerage`)

A second, unrelated feature: split sales broker-wise, compute 0.5% commission
per broker, track who's been paid vs. still owed (settle-all supported), and
show analytics (monthly comparison, top buying parties, parties who dropped
off month over month). Export any broker's statement as WhatsApp text, Excel,
or PDF.

Reports get into the system two ways:

- **Automatically, from the daily Vyapar sync** (no manual step). Vyapar
  tracks brokers as **party groups** that customers belong to (e.g. a group
  literally named "Rajesh" or "Tota Brokar") - `kb_names.name_group_id` joins
  to `kb_party_groups`. Every SALE line item from a customer in a group that
  matches a known broker (`BROKER_MAP` in `src/lib/brokerage/brokerRules.ts`,
  after stripping a trailing "broker"/"brokar" word) is attributed to that
  broker; everything else (geographic/functional groups like "MAUGANJ" or
  "General", or no group at all) counts as Shop Own Sale, same as an
  ungrouped customer. The sync derives one report per calendar month found in
  the backup but only **upserts the current and previous month** into
  `BrokerageReport` (`source: VYAPAR_SYNC`) on every run - older, already-
  settled months aren't reprocessed daily. A derived report keeps the same
  row id across re-syncs (only its broker/transaction rows are replaced), so
  any payments you've recorded against it are never lost to the next day's
  sync.
- **Manually**, by uploading a raw monthly "Sale Report" Excel (`.xlsx`, with
  a `Sale Items` sheet and a `Bro.` column) on the Brokerage page
  (`source: UPLOAD`) - useful for backfilling months from before this app
  existed, or a business that doesn't use Vyapar for a given sale.

This is a separate business domain from Vyapar dues tracking - a broker earns
commission on sales regardless of which customer bought - so it has its own
tables (`BrokerageReport`, `BrokerageBrokerSummary`, `BrokerageTransaction`,
`BrokeragePayment`), but lives in the same app, same login, same database.

```
Google Drive (.vyb)  --daily-->  GitHub Actions job  --sync-->  Postgres  <--read--  Next.js app (Vercel)
```

Deliberately split this way: the sync pipeline uses native/Node-only
packages (`better-sqlite3`, `adm-zip`, `googleapis`) that don't belong in a
Vercel serverless bundle, so it runs as a plain scheduled script instead.

## Vyapar column mapping

Vyapar's internal SQLite schema isn't publicly documented, so
`src/lib/sync/columnMap.ts` resolves columns by fuzzy name matching against a
list of candidates rather than assuming fixed names. The mapping has been
**verified against a real production `.vyb` backup** (4,600+ transactions,
years of history), which caught two things that don't match the "obvious"
column names:

- There's no direct total-amount column on a transaction. A sale's true total
  is the sum of its own `kb_lineitems.total_amount` rows; `txn_cash_amount`
  (which looks like a total-amount candidate by name) is actually the amount
  for *payment*-type transactions (types 3/4) and is ~0 for credit sales -
  using it as the total silently zeroes out `totalAmount`/`balanceAmount` for
  most invoices.
- `kb_lineitems` has no item-name column at all, only `item_id`; the name
  lives on `kb_items.item_name` and has to be joined in.

If your Vyapar schema differs (e.g. a different app version), run:

```bash
npm run inspect-vyp -- /path/to/your-backup.vyb
```

to print every table, its columns, and a sample row, and compare against
`src/lib/sync/columnMap.ts`. The `txn_type` code mapping (which numbers mean
"Sale" vs "Payment In" etc., in `TXN_TYPE_MAP`) is also worth double-checking
against your own data - types 1/2/3/4 (Sale/Purchase/Payment In/Payment Out)
are verified; 5/6/65 are left as OTHER for lack of confident evidence.

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
