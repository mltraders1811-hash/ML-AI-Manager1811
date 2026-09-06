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
const appUrl = process.env.MOBILE_APP_URL ?? "https://ml-ai-manager1811.vercel.app";

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
    allowNavigation: [new URL(appUrl).host],
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
