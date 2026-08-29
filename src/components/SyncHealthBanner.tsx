import type { SyncHealth } from "@/lib/syncHealth";

/** Shown above the numbers when they can't be trusted to be current -
 * silently serving yesterday's figures as if they were today's is the
 * failure mode worth guarding against. */
export function SyncHealthBanner({ health }: { health: SyncHealth }) {
  if (!health.warning) return null;

  const isError = health.status === "failed" || health.status === "never";
  const tone = isError
    ? "border-red-300 bg-red-50 text-red-800"
    : "border-amber-300 bg-amber-50 text-amber-900";

  return (
    <div className={`mb-6 rounded-2xl border p-4 ${tone}`} role="status">
      <p className="text-sm font-semibold">
        {health.status === "failed"
          ? "Last sync failed"
          : health.status === "stale"
            ? "Figures may be out of date"
            : "No data yet"}
      </p>
      <p className="mt-1 text-sm">{health.warning}</p>
      {health.errorMessage ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold">What went wrong</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words text-xs opacity-80">
            {health.errorMessage.slice(0, 600)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
