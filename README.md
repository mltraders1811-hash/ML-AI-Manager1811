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

The same job then reads any new **bank statement** dropped in a second Drive
folder and reconciles it against those customers - see Bank reconciliation below.

The Next.js app reads from that Postgres database to power the dashboard,
WhatsApp reminder links, and the AI chat assistant.

## Collections (`/overdue`, `/customers`)

`/overdue` lists who owes money, oldest bills first. Each customer expands to
show their unpaid bills with dates, due dates and days overdue, and a WhatsApp
reminder built from your own template (edited at `/settings/overdue`, with
`{party}`, `{amount}`, `{days}`, `{invoice_count}`, `{invoice_lines}`,
`{balance}` and `{credit_days}` placeholders). Search, sort and credit-period
chips narrow the list.

An ageing strip splits the overdue money into 1-30 / 31-60 / 61-90 / 90+ day
bands, each clickable to filter the list. Bills are banded by their own age
rather than the customer's worst one, so a party with one ancient invoice and
several recent ones shows up in several bands instead of overstating how
stuck the book is. The bands always sum to the overdue total - debt that ties
to no bill anywhere in the backup necessarily predates the invoice history,
so it lands in the oldest band rather than being dropped.

Sending a reminder is recorded, so each row says whether that party has
already been chased and how recently - and, by comparing what they owed then
against what they owe now, whether the reminder actually worked ("paid
₹5,000 since" vs "no payment since"). A **Not chased** sort puts the
never-reminded first, then whoever was chased longest ago, which is the order
to work through. Expanding a row shows the full history.

Credit terms are per customer (`/customers`), falling back to a company-wide
default. The phone book is also where you fill in missing phone numbers -
Vyapar has none for most parties, and a reminder can't be sent without one.
Names and balances there are read-only since the sync overwrites them nightly;
phone, note and credit days are yours and survive every sync.

How the overdue amount is derived: the customer's authoritative balance
(`Customer.currentBalance`) is spread back across their invoices newest-first,
so each bill gets an "unpaid" figure that carries an age while the per-invoice
amounts still sum exactly to the balance. Any balance older than the backup's
invoice history is counted as overdue rather than dropped.

## Invoices (`/invoices`)

Browse sales by day, or search by party name or bill number, and open any
invoice for its line items. Each one can be exported as a branded PDF, styled
at `/settings/invoice-design` (business name, address, phone, GSTIN, accent
colour, footer note, and whether to print the item table).

## Items (`/inventory`)

What actually sold over the last 7/30/90 days, by item: quantity, revenue,
and the rate genuinely achieved against the item's list rate, so consistent
discounting is visible. Plus the item master with its rates.

**No profit margins, deliberately.** Checked against the real backup: only 71
of the 397 items actually sold carry a purchase rate in Vyapar - sales get
entered, buying rates rarely do. A first version costed that 18% and reported
an 82.9% margin on a grain wholesale business, because a missing cost reads
as zero. Stock on hand is omitted for the same reason: `item_stock_quantity`
is negative for 1,705 of 2,110 items (down to -15 lakh) because goods leave
without purchases going in, so it isn't a stock figure. Fill in purchase
rates in Vyapar and margins become computable; until then the app says so
rather than publishing a confident wrong number.

## Bank reconciliation (`/bank`)

Vyapar knows what each party was **billed**. Only the bank knows what actually
**arrived** - and a bank narration says `UPI/CR/451203377421/SHARMA TRAD/HDFC`,
not which customer that is. `/bank` closes that gap: it reads the statement,
matches what it can, and asks one question about the rest - *kiska payment hai?*

**Getting the statement in.** Two ways, and they dedupe against each other:

- **Automatic (daily).** Point `GDRIVE_BANK_STATEMENT_FOLDER_ID` at a Drive
  folder shared with the same service account. Every morning, right after the
  Vyapar sync, whatever is new in that folder is read and reconciled. Most
  net-banking portals will email or export a statement on a schedule - a Gmail
  filter that saves the attachment to Drive is enough to make this hands-off.
  There is no transaction API to connect to here: no Indian bank offers a small
  shop one, and the account-aggregator route needs a licensed intermediary, so
  the scheduled statement *is* the connection.
- **By hand.** Tap **Add statement** on the phone and pick the file. Useful the
  first time, and for a bank that won't export on a schedule.

CSV and `.xlsx` are read (PDF is not - download the same statement as CSV).
There is no per-bank parser: the header row is detected and columns are mapped
by keyword, so HDFC's `Withdrawal Amt./Deposit Amt.`, SBI's `Debit/Credit` and
Kotak's single `Amount` + `Dr / Cr` all work, as do day-first, ISO and
`05-Aug-26` dates, `(4,500.00)` for money out, and narrations containing commas.

**Re-reading a statement is always safe.** Every line carries a fingerprint of
its date, amount, direction, narration and position among identical lines that
day, so an overlapping download - or the same file uploaded twice - adds
nothing rather than doubling the month.

**Matching.** Each credit is scored against the customer list on three signals:

1. **A learnt rule.** The first time you say "this counterparty is Sharma
   Traders", it is remembered. From then on that payer is recognised on sight,
   whatever the amount - which is what makes month two much quicker than month one.
2. **The name in the narration.** Rails, bank codes, IFSC fragments and
   reference numbers are stripped out; what's left is matched prefix-tolerantly
   (`SHARMA TRAD` = Sharma Traders), space-insensitively
   (`SHARMATRADERS@OKHDFCBANK`), and ignoring `M/s`, `Pvt` and `Ltd`.
3. **Corroboration.** The payer's phone number appearing in the narration, or
   an amount that exactly matches one of that party's recent bills.

A name match alone suggests but never decides; it takes a learnt rule, or a
name plus corroboration, to assign a payment automatically - and two similarly
named parties always go to a person instead. Everything else lands in the
**Kiska hai?** tab, each entry showing the top three guesses with the reason
underneath, a full customer search behind them, and **Payment nahi** for what
isn't a customer payment at all. When several undecided entries share a payer,
one tap clears them all; **Change** undoes a wrong match *and* forgets the rule
that caused it, so the same mistake isn't repeated every month.

**It never writes back to Vyapar's figures.** Customer balances and invoices
are rebuilt from the Vyapar backup on every sync, so anything recorded into
them would be silently overwritten the next morning. The bank ledger is
therefore its own record, sitting beside them: what was billed (Vyapar) against
what turned up (bank), with a name against each receipt.

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
- **`txn_type` 5 is a "Receivable opening balance"**, confirmed by Vyapar's
  own `txn_description`: one row per party, all dated the first day of the
  financial year, carrying what that party already owed before any invoice in
  the backup. Its amount lives in `txn_balance_amount` alone (no line items,
  no cash), so a reader looking only at those two would record it as zero -
  which hid 20 parties' entire debt. Type 6 is the supplier-side twin
  ("Payable opening balance"), unused here; 65 is a rare sale variant.
- **A transaction's own `txn_balance_amount` does not track payments made
  against it.** Vyapar links a payment to a specific invoice in a separate
  table (`kb_txn_links`), but never updates that invoice's own balance field
  to reflect it - it stays at the invoice's original amount forever, even
  once fully paid. Summing `Invoice.balanceAmount` therefore overstates a
  customer's real debt (verified against real data: 10-27x too high per
  customer, ~10x in aggregate). The number that's actually correct - and
  matches what Vyapar's own app shows - is `kb_names.amount`, a running
  balance Vyapar maintains per party. The dashboard's Total
  Outstanding/Overdue figures and the AI chat's balance lookups are computed
  from `Customer.currentBalance` (synced from `kb_names.amount`), not from
  summing invoices - see the comment on that field in `prisma/schema.prisma`
  and on `getOverdueCustomers` in `src/lib/metrics.ts`. Invoice-level
  balances are still synced and kept (useful as a record of each invoice as
  originally raised, and their due dates still drive which customers count
  as "overdue" and since when), but should not be read as "amount still
  owed on this invoice."

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

That's it - the `build` script (`prisma db push --accept-data-loss && tsx
prisma/seed.ts && next build`) creates the schema and seeds the V1 company
automatically on every Vercel deploy, so there's no separate migration step
to run by hand. `--accept-data-loss` is there because `db push` otherwise
refuses non-interactively whenever a schema change *could* lose data (even
a brand-new, currently-empty unique constraint counts) - fine for this
single-tenant app's low-stakes schema, but worth knowing if you ever add a
schema change that's genuinely destructive (e.g. dropping a populated
column), since this flag would let that through unprompted too.

### 2. Google Drive access

1. Create a Google Cloud service account, download its JSON key, and enable
   the **Google Drive API** for that project.
2. Share your Vyapar backup folder in Drive with the service account's `client_email` (Viewer access).
3. Copy the folder's ID (from its URL) into `GDRIVE_BACKUP_FOLDER_ID`.
4. Put the full JSON key (as one line) into `GOOGLE_SERVICE_ACCOUNT_JSON`.

If you also want bank statements picked up automatically (see Bank
reconciliation above), share a second folder with the same `client_email` and
put its ID in `GDRIVE_BANK_STATEMENT_FOLDER_ID`. Leaving it blank just means
statements are uploaded by hand from `/bank`.

Point `GDRIVE_BACKUP_FOLDER_ID` at the **top-level** folder Vyapar backs up
to (e.g. "Vyapar Mobile"), not at a month folder inside it. Vyapar files its
`.vyb` backups into per-month subfolders (`08-2026`, `09-2026`, ...) and
creates a fresh one on the 1st of each month, so `findLatestBackup` searches
the folder *and* its subfolders. Pointing directly at a month folder would
appear to work and then silently stop finding new backups once the month
rolled over.

### 3. Admin login

Pick a username for `ADMIN_USERNAME`, then hash a strong password:

```bash
node scripts/hash-password.mjs 'your-strong-password'
```
Put the output into `ADMIN_PASSWORD_HASH`. Generate `SESSION_SECRET` with
`openssl rand -base64 32`.

### 4. Daily sync (GitHub Actions)

Push this repo to GitHub, then add these as **repository secrets**
(Settings → Secrets and variables → Actions):

- `DATABASE_URL`
- `DEFAULT_COMPANY_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GDRIVE_BACKUP_FOLDER_ID`
- `GDRIVE_BANK_STATEMENT_FOLDER_ID` (optional - enables the daily bank
  statement pickup; without it the sync skips that step entirely)

`.github/workflows/daily-sync.yml` runs it every day at 08:30 IST, and can
also be triggered manually from the Actions tab - or from the **"Sync Now"**
button on the dashboard (see step 6).

### 5. Dashboard (Vercel)

Import the repo into Vercel, set the same env vars (`DATABASE_URL`,
`DEFAULT_COMPANY_ID`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`)
plus `ANTHROPIC_API_KEY` for the chat assistant. Deploy - that's it, no server
to manage.

### 6. "Sync Now" button (optional)

The dashboard has a **Sync Now** button that kicks off the same GitHub
Actions job on demand, instead of waiting for the 08:30 IST schedule (it
triggers the workflow rather than re-running the sync inside Vercel, since
the sync needs native Node modules that don't belong in a Vercel function -
see "How it works" above). To enable it:

1. On GitHub, go to **Settings → Developer settings → Personal access
   tokens → Fine-grained tokens**, create one scoped to just this repo, with
   **Actions: Read and write** permission.
2. Add it to Vercel as `GITHUB_SYNC_TOKEN`, then redeploy.

Without this token the button still shows but returns a clear "not set up
yet" message instead of failing silently.

### 7. Phone app and notifications (optional)

The dashboard is a PWA: on Android, Chrome offers an **Install** banner that
puts it on the home screen; on iPhone it's Safari's Share ▸ **Add to Home
Screen**. Installed, it opens without browser chrome and keeps working
offline - pages you have already opened are served from a local copy, always
with a banner saying how old that copy is. API responses are never cached,
and logging out wipes the cached pages.

Push notifications are opt-in and need one keypair:

```bash
node -e "console.log(JSON.stringify(require('web-push').generateVAPIDKeys(),null,2))"
```

Add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in **two** places - Vercel
(so the browser can subscribe) and GitHub Actions secrets (so the daily sync
can send). Then open **Alerts** on the dashboard and turn them on; there's a
test button to confirm delivery before relying on it.

Two things get sent, both from the sync job:

- the **daily overdue digest**, after a successful sync, only when something
  is actually past its credit period and worth more than ₹1,000. A quiet day
  sends nothing, which is what keeps the alert meaningful.
- a **sync failure alert**, so figures that have stopped updating don't get
  read as current ones.

The digest is deduped on the IST calendar day, so pressing Sync Now after
the morning run doesn't buzz the phone twice.

On iPhone, web push works **only** once the app is on the home screen (iOS
16.4+); the Alerts screen says so rather than showing a toggle that can't
work.

## Backups

Most of this database is disposable - customers, invoices, line items and
inventory are rebuilt from Vyapar on every sync, so losing them costs a sync
run. What isn't: brokerage payments, manually uploaded reports, the phone
numbers and credit terms typed into the phone book, and the reminder and
invoice-design settings. Those exist only here.

`.github/workflows/backup.yml` exports them weekly and keeps the file as a
build artifact (90 days, GitHub's maximum - download one occasionally for a
copy that outlives that). `Download backup` on `/settings/overdue` produces
the same file on demand. Customer edits are keyed by their Vyapar id rather
than our own uuid, so a restore can re-attach them after a fresh sync
recreates the rows.

The export fails loudly on an empty result rather than quietly archiving an
empty file every week, which is the failure mode that makes a backup worse
than none.

## When the sync breaks

The dashboard shows a banner when the figures can't be trusted to be current:
a red one if the last sync failed (with the reason), an amber one if no sync
has succeeded in 36 hours. One missed daily run is tolerated silently; two in
a row is surfaced. Silently serving yesterday's numbers as if they were
today's is the failure this guards against.

On the job side, `daily-sync.yml` writes a plain-language summary onto the
run page saying what went wrong and what usually causes it, so GitHub's
"workflow failed" email leads somewhere useful. A failure that happens before
the sync properly starts (bad config, unreachable Drive) is still recorded as
a failed run so the banner appears.

## Tests

```bash
npm test
```

Needs a throwaway Postgres (point `DATABASE_URL` at one - never the real
database, the suite truncates tables). `.github/workflows/ci.yml` runs the
same thing on every push against a disposable service container.

The tests build a **synthetic Vyapar backup** (`tests/fixtures/makeVyb.ts`)
rather than using a real one, so they run anywhere and contain no customer
data. That fixture deliberately reproduces every schema quirk documented
above - credit sales with no cash amount, stale invoice balances, item names
behind a join, an opening balance whose amount lives in the balance column -
because each of those caused a real bug. Each assertion was checked by
re-introducing the bug it guards and confirming the test goes red.

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
- No multi-user accounts - one shared admin username/password.
