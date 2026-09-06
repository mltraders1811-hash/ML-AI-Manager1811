// Talking to the Android shell from the web app.
//
// The same build serves the browser and the app, so everything here is
// guarded: on the web isNativeApp() is false and nothing else is ever
// called. @capacitor/core is imported dynamically for the same reason - a
// browser visitor should not download the bridge for an app they are not
// running.

export type BankSmsStatus = {
  available: boolean;
  configured: boolean;
  permissionGranted: boolean;
  canReadInbox: boolean;
  endpoint: string;
  banks: string;
  accounts: string;
  forwardedCount: number;
  /** Epoch millis, 0 when nothing has been forwarded yet. */
  lastForwardedAt: number;
  lastResult: string;
  /** Only present in the reply to catchUp(). */
  scanned?: number;
  queued?: number;
};

export type BankSmsPlugin = {
  configure(options: { endpoint: string; token: string; banks: string; accounts: string }): Promise<BankSmsStatus>;
  getStatus(): Promise<BankSmsStatus>;
  requestPermission(): Promise<BankSmsStatus>;
  catchUp(options: { days: number }): Promise<BankSmsStatus>;
  sendTest(options: { text: string; sender?: string }): Promise<BankSmsStatus>;
};

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True only inside the installed Android app, never in a browser. */
export function isNativeApp(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

let cached: BankSmsPlugin | null = null;

/** The native SMS bridge, or null when running anywhere but the app. */
export async function getBankSms(): Promise<BankSmsPlugin | null> {
  if (!isNativeApp()) return null;
  if (cached) return cached;
  const { registerPlugin } = await import("@capacitor/core");
  cached = registerPlugin<BankSmsPlugin>("BankSms");
  return cached;
}
