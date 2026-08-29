import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline - M.L AI Manager" };

/**
 * Shown when the phone is offline and this particular page was never
 * cached. Deliberately says nothing about money: the one thing worse than
 * no figures is figures we can't vouch for.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-2xl">
          📶
        </div>
        <h1 className="text-lg font-bold text-neutral-900">Internet nahi hai</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Yeh page pehle khola nahi gaya tha, isliye iska koi copy save nahi hai. Internet aane par
          dobara kholein.
        </p>
        <p className="mt-4 text-xs text-neutral-500">
          Jo pages aap pehle dekh chuke hain, woh offline bhi khulenge - purane numbers ke saath, aur
          upar warning ke saath.
        </p>
      </div>
    </main>
  );
}
