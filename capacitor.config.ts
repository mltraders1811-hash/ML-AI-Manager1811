import type { CapacitorConfig } from "@capacitor/cli";

// The Android app is a native shell around the same deployment the browser
// uses, not a second copy of the app: the screens need the Postgres behind
// them, so bundling a static copy would only ever show an empty one. What
// the shell adds is the part a browser cannot do - reading the bank's SMS
// off the phone (see BankSmsPlugin.java) - plus proper file downloads and a
// home-screen icon that survives a browser cache clear.
//
// MOBILE_APP_URL is read at build time so a debug build can point at a
// preview deployment or a laptop's dev server.
//
// A variable that is declared but not set arrives as the empty string, not
// as undefined - a workflow expanding an unset `vars.MOBILE_APP_URL` does
// exactly that - and `??` would keep it, leaving the app pointed at "". The
// same trap the server's env parsing guards against; see optionalEnv in
// src/lib/env.ts.
const configured = process.env.MOBILE_APP_URL?.trim();
const appUrl = configured ? configured : "https://ml-ai-manager1811.vercel.app";

/** The URL is the whole app, so a broken one must fail loudly and by name. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    throw new Error(`MOBILE_APP_URL is not a valid URL: ${JSON.stringify(url)} (it needs the https:// too)`);
  }
}

const config: CapacitorConfig = {
  appId: "in.mlaimanager.app",
  appName: "M.L Manager",
  // Only the offline fallback page lives here; everything real is served
  // from appUrl above.
  webDir: "android-shell/www",
  server: {
    url: appUrl,
    // Anything not on this host - a wa.me reminder link above all - opens in
    // the phone's own browser or WhatsApp instead of being trapped in the
    // app's WebView.
    allowNavigation: [hostOf(appUrl)],
    androidScheme: "https",
    // Shown instead of Chrome's "webpage not available" when the phone has
    // no connection; the page says so in the owner's own words.
    errorPath: "index.html",
  },
  android: {
    // The books are not something to hand to a screenshot in the recents
    // switcher, and a WebView that allows mixed content is a downgrade on
    // what the browser already enforces.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
