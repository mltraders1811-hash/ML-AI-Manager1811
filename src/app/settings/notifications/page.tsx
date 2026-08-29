import Link from "next/link";

import { NotificationToggle } from "@/components/NotificationToggle";

export const dynamic = "force-dynamic";

export default function NotificationSettingsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Alerts</h1>
          <p className="text-xs text-neutral-500">Phone par notification kab aaye</p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
        >
          Dashboard
        </Link>
      </header>

      <NotificationToggle />

      <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
        <p className="text-sm font-semibold text-neutral-900">Kya kya notification aati hai</p>
        <ul className="mt-2 space-y-1 text-xs text-neutral-600">
          <li>
            <strong>Roz ka overdue summary</strong> - subah ke sync ke baad, sirf tab jab credit
            period cross kar chuka paisa baaki ho.
          </li>
          <li>
            <strong>Sync fail hone par</strong> - taaki purane numbers ko naya samajhne ki galti na ho.
          </li>
        </ul>
        <p className="mt-3 text-xs text-neutral-500">
          Har notification par ek hi baar buzz hota hai - din mein sync do baar chale to bhi dobara
          nahi aati.
        </p>
      </div>
    </main>
  );
}
