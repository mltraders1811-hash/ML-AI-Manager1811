export function MetricCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "overdue" | "brand";
}) {
  const valueClass = tone === "overdue" ? "text-overdue" : tone === "brand" ? "text-brand" : "text-neutral-900";
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${valueClass}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-neutral-400">{sub}</p> : null}
    </div>
  );
}
