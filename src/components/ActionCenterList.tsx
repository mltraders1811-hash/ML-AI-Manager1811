import type { OverdueCustomer } from "@/lib/metrics";
import { formatDateDDMMYYYY, formatInr } from "@/lib/format";
import { buildWhatsAppReminderLink } from "@/lib/whatsapp";

export function ActionCenterList({ customers }: { customers: OverdueCustomer[] }) {
  if (customers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
        No overdue accounts. Nice work! 🎉
      </div>
    );
  }

  return (
    <div className="divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      {customers.map((c) => {
        const link = buildWhatsAppReminderLink({ phone: c.phone, amount: c.totalOverdue, dueSince: c.oldestDueDate });
        return (
          <div key={c.customerId} className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="truncate font-semibold text-neutral-900">{c.name}</p>
              <p className="text-xs text-neutral-500">
                {c.invoiceCount} invoice{c.invoiceCount > 1 ? "s" : ""} on file · overdue since {formatDateDDMMYYYY(c.oldestDueDate)} ({c.daysOverdue}d)
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="font-bold text-overdue">₹{formatInr(c.totalOverdue)}</span>
              {link ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90"
                  aria-label={`Send WhatsApp reminder to ${c.name}`}
                >
                  WhatsApp
                </a>
              ) : (
                <span className="rounded-lg bg-neutral-100 px-3 py-2 text-xs font-medium text-neutral-400" title="No phone number on file">
                  No phone
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
