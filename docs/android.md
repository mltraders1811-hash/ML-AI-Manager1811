# The Android app

The same app, installed on the phone as an app rather than a browser tab -
and doing one thing a browser cannot: **reading the bank's SMS itself**, so a
customer's payment appears on the Bank screen seconds after it lands, with no
forwarding app in between.

It is a [Capacitor](https://capacitorjs.com) shell around the deployed web
app, not a second copy of it. The screens still come from the same Vercel
deployment and the same Postgres, so there is one codebase, one deploy, and no
version of the app that can show yesterday's figures because it shipped a
month ago.

## What the app adds over the website

| | Browser | Android app |
| --- | --- | --- |
| Reads bank SMS by itself | no | **yes** - `RECEIVE_SMS`, filtered on the phone |
| Catches up on SMS from before it was installed | no | **yes** - last 7 days, on a tap |
| Invoice PDFs / Excel exports | download normally | handed to Android's download manager |
| Home-screen icon that survives clearing browser data | no | yes |
| Daily overdue push notification | yes | **no** - see "Notifications" below |

## Installing it

There is no Play Store build, deliberately. Google grants `RECEIVE_SMS` only
to apps that are the phone's default SMS or dialer app, which this is not - so
a Play release would mean giving up the one feature the app exists for. It is
installed directly instead, which is normal for a business's own app.

1. **Build it.** Actions → *Android app* → *Run workflow*. Leave the URL blank
   to point at production.
2. **Download the APK** from that run's artifacts and open it on the phone.
   Android will ask to allow installing from this source; that prompt is
   what "install directly" means.
3. **Sign in** as usual - the app is the same login.
4. **Set up SMS** at *Bank → SMS*, three taps: give permission, connect the
   phone (the endpoint and token come from the server; nothing is typed), and
   send a test message to prove the whole path works.

`BANK_INGEST_TOKEN` must be set on the server first, or step 2 of that screen
will say so.

### "App not installed"

Android says this for several unrelated reasons; in order of how often they
are the actual one:

1. **You tried to install the zip.** Every GitHub Actions artifact downloads
   as a `.zip`, and a phone cannot install one. Unzip it and install the
   `.apk` inside - or push a tag (`git tag android-v1 && git push --tags`),
   which publishes the `.apk` straight onto a release, so the phone downloads
   something it can open directly.
2. **A copy is already installed with a different signature.** A debug-signed
   build and a release-signed one are different apps to Android even at the
   same version. Uninstall the old one first; nothing is lost but the login.
3. **Play Protect blocked it.** "Install anyway" on the prompt, or turn the
   scan off for the install and back on afterwards.
4. **The phone's own security app blocked it.** Xiaomi, Realme, Oppo and Vivo
   phones refuse sideloads with this exact wording and no other explanation:
   - **Xiaomi / MIUI / HyperOS**: Settings → Privacy protection → Special
     permissions → Install unknown apps → allow for the app you are
     installing *from* (Files, Chrome). If it still refuses, Security app →
     Settings → turn off "Scan apps before installing". A Mi account signed
     in and a working connection are sometimes required for its check to
     pass at all.
   - **Realme / Oppo (ColorOS)**: Settings → Password & security → System
     security → Install external sources.
   - **Vivo (Funtouch)**: i Manager → Software install permissions.
   - **Samsung**: the "unknown apps" prompt is per-app and appears on the
     first attempt; if it never appeared, the browser or file manager was
     denied earlier and needs re-allowing in Settings → Apps → Special
     access.
5. **The phone is older than the app allows.** The build needs Android 7
   (SDK 24) or newer; every build's summary prints the package, version and
   minimum SDK for exactly this check.
6. **The download was incomplete** - reinstall from a fresh download.

Note that Expo Go cannot open this app. Expo Go runs React Native bundles
from Expo projects; this is a web app in a Capacitor shell with its own
native Java, and neither half is something Expo Go can load.

## Signing

Without a signing key the workflow still produces an installable APK, signed
with Android's debug key - fine for trying it out, but a debug-signed app and
a properly-signed one are different apps to a phone, so the first real build
must be signed or the app has to be uninstalled and reinstalled (losing
nothing but the login).

Make a key once:

```bash
keytool -genkey -v -keystore ml-manager.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias ml-manager
```

Keep the file somewhere safe and back it up: **lose it and no future build can
update the installed app.** Then add four repository secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 ml-manager.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | the store password |
| `ANDROID_KEY_ALIAS` | `ml-manager` |
| `ANDROID_KEY_PASSWORD` | the key password |

Tag a release to build a signed one: `git tag android-v1 && git push --tags`.

## What leaves the phone

Only messages that pass a filter running **on the device** - the bank must
match `BANK_ALERT_BANKS`, the account must match `BANK_ALERT_ACCOUNTS` (by
common suffix, since ICICI writes `XX811` where HDFC writes `XXXXXX1811`), and
the message has to look like a transaction. A personal message, an OTP, a card
offer, another account's alert: none of it is sent anywhere, and none of it is
logged.

That filter is `android/app/src/main/java/in/mlaimanager/app/SmsFilter.java`,
kept free of Android imports so it can be unit-tested on a plain JVM - which
CI does on every build. Its two failure modes are not equal: forwarding
something private is a privacy failure, and dropping a bank message is a
silent one, so the tests cover both directions.

A message that passes is handed to WorkManager, which owns the retrying: it
survives the app being killed, the phone rebooting and a night with no signal.
The server then decides what the message means, and answers `200` even when it
declines to book it - so a promotional SMS that slips through the phone filter
is recorded and ignored rather than retried for ever.

## Notifications

Push does not work inside the app: a WebView has no push service behind it.
The daily overdue digest keeps arriving on whichever browser was subscribed,
and the Alerts screen says as much when opened in the app rather than showing
a switch that does nothing.

Making it work in the app means Firebase Cloud Messaging - a Firebase project,
`google-services.json`, `@capacitor/push-notifications`, and the sync job
sending through FCM alongside web-push. Worth doing if the app becomes the
only way the shop uses this; not needed for the SMS feature.

## Working on it

The Capacitor CLI needs **Node 22 or newer** (the web app itself is happy on
20, which is why CI builds the two with different versions).

```bash
npm run android:sync      # copy config into the Android project
npm run android:test      # the on-phone filter's unit tests
npm run android:apk       # debug APK (needs the Android SDK locally)
npm run android:icons     # regenerate icons from the brand assets
```

Point a build at somewhere other than production with `MOBILE_APP_URL`:

```bash
MOBILE_APP_URL=https://ml-ai-manager1811-preview.vercel.app npm run android:apk
```

The `android/` project is committed rather than generated on each build, so
what CI compiles is what is in the repository - the native code lives there,
and regenerating it would throw that away.
