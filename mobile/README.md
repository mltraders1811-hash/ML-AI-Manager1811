# M.L Orders - Android order book

An offline order-taking app for the shop counter, built with Expo (React
Native). Write an order while the party is standing there, send it to them on
WhatsApp, and see at a glance what is still to be delivered and what money is
still out.

Everything lives in a SQLite database **on the phone**. There is no server, no
login and no internet requirement - which is the point: orders get written in
godowns and market lanes where the signal is not.

## What it does

| Screen | What it is for |
| --- | --- |
| **Home** | Today's sales, the month so far, money still to collect, orders still to deliver, and the last five bills. |
| **Orders** | Every bill, searchable by party, order number or broker, filtered by status or by "unpaid". |
| **New order** | Party, date, broker, then a line per item: bags, kilos, rate. The total adds up as you type. |
| **Order** | The bill itself - send it on WhatsApp, call the party, record a part payment, move it Pending → Packed → Delivered, edit or delete. |
| **Parties** | The phone book, with what each party owes and their full order history. |
| **Items** | The catalogue, with the rate each item is usually billed at and its bag weight. |
| **Reports** | Sales, weight and dues for a period, top items, top parties, brokerage owed - and CSV export. |
| **Challan** | Two A6 copies straight off an order — one goes with the gadi, one comes back signed. Print, PDF or WhatsApp. |
| **More** | Shop name, brokers, transporters, backup and restore, sample data. |

### The things that make it a shop's app, not a generic CRUD form

- **Bags and kilos both.** Stock is counted in bags, billed in kilos. Type the
  bag count and the weight fills in at the item's bag weight; overwrite it with
  what the scale actually said and the app leaves your figure alone.
- **Rates remember themselves.** Choosing an item fills in the rate it was last
  set to, which is right far more often than it is wrong, and is one tap from
  being changed.
- **Money is derived, never flagged.** Paid / part paid / unpaid comes from what
  has been received against the bill, so it cannot drift out of step with the
  figures. A bill short by a few paise counts as settled.
- **Indian number formatting** throughout - ₹2,02,550, not ₹202,550.
- **History does not rewrite itself.** A bill keeps its own copy of the party
  and item names, so deleting an item or renaming a broker never changes what
  an old order says it was.
- **The challan is not a second form.** Everything it prints — party,
  destination, goods, transporter, gadi number — is already on the order, so
  issuing one is a single tap. The lorry is noted when the order is written.
  Two A6 pages come out of the printer: the transporter's copy and the office
  copy that comes back signed, the way the handwritten pad is already used.

## Running it

```bash
cd mobile
npm install
npx expo start          # then scan the QR code with Expo Go on the phone
npm run android         # or open it straight on a connected device/emulator
```

`npm test` runs the order maths and the whole database layer against Node's own
SQLite - no device needed. `npm run typecheck` type-checks the app.

## Building the APK

The app uses `expo-sqlite`, which is native code, so it needs a real build
rather than Expo Go for day-to-day use.

**With EAS (no Android SDK needed locally):**

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview   # -> an installable .apk
```

The `preview` profile in `eas.json` produces an APK you can download and tap to
install. `production` produces an app bundle for the Play Store.

**Locally, if you have Android Studio and a JDK:**

```bash
npx expo prebuild --platform android   # generates the android/ project
cd android && ./gradlew assembleRelease
```

The generated `android/` folder is deliberately not committed - it is
regenerated from `app.json` every time, so the configuration has exactly one
home.

## The data

Nothing leaves the phone unless you send it. Two ways to get data out:

- **Reports → Export to CSV** - one row per order line, opens in Excel, Google
  Sheets or an accounting import.
- **More → Back up to a file** - the entire database as JSON, through the
  Android share sheet. **More → Restore from a file** puts it back on a new
  phone. Restoring replaces everything, so take a backup before you do it.

The parties, items and brokers the app starts with were taken from the shop's
own July 2026 sale report, so the first order can be written without typing a
catalogue first. **More → Load sample orders** adds the 16 real bills from that
report if you want to see the reports and dashboard with a month of business in
them.

## How it is put together

```
mobile/
  src/
    app/            expo-router screens (file = route)
      (tabs)/       Home, Orders, Parties, Items, More
      order/        new.tsx (the form, also used for editing), [id].tsx
      party/        [id].tsx, also serves /party/new
    components/     the small UI kit everything is built from
    db/             schema + migrations, queries, seed data, backup
    lib/            money, dates, order maths, CSV, WhatsApp - all pure
    theme/          colours, spacing, type scale
  tests/            vitest: order maths, formatting, and the real SQL
```

The rule the structure follows: **anything that decides a number lives in
`src/lib` or `src/db` and is tested**; the screens only arrange it on glass.
Adding a migration means appending one SQL string to `MIGRATIONS` in
`src/db/schema.ts` - the database records how many it has run, so an update
never costs a shop its order book.
