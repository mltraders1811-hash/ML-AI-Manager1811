"use client";

import { useEffect, useState } from "react";

import { isNativeApp } from "@/lib/native";

/**
 * Web push does not exist inside the Android shell - a WebView has no push
 * service behind it - so the toggle on this screen cannot work there, and
 * silently showing a switch that does nothing would be worse than saying so.
 *
 * The daily digest still reaches the owner on whichever browser they
 * subscribed with. Making it work in the app means Firebase Cloud Messaging
 * (a Firebase project, google-services.json, and the sync job sending
 * through FCM as well as web-push) - a separate piece of work, noted in
 * docs/android.md.
 */
export function NativePushNote() {
  const [native, setNative] = useState(false);

  useEffect(() => {
    setNative(isNativeApp());
  }, []);

  if (!native) return null;

  return (
    <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">Is app me notification abhi nahi aati</p>
      <p className="mt-1 text-xs text-amber-800">
        Android app bank ke SMS padhti hai, lekin push notification nahi bhej sakti. Roz ka overdue
        summary usi browser par aayega jahan aapne notification chalu ki thi - Chrome me app kholkar
        wahan se on kar dein.
      </p>
    </div>
  );
}
