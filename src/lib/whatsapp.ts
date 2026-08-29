import { formatDateDDMMYYYY, formatInr } from "@/lib/format";

/** Normalizes a phone number to wa.me's digits-with-country-code form, or
 * null when there aren't enough digits to be a real number. */
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  // Assume an Indian mobile number when no country code is present.
  return digits.length === 10 ? `91${digits}` : digits;
}

/** wa.me deep link carrying an already-composed message (the per-customer
 * reminder rendered from the owner's own template - see src/lib/overdue.ts). */
export function buildWhatsAppLink(phone: string | null, message: string): string | null {
  const number = toWhatsAppNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/**
 * Builds a wa.me deep link with a pre-filled, text-only reminder message.
 * No WhatsApp Business API / Twilio needed - the link just opens the
 * user's own WhatsApp with the message ready to send, which is what "1-Click
 * WhatsApp Reminder" means in the V1 spec. Returns null when the customer
 * has no phone number on file (nothing to link to).
 */
export function buildWhatsAppReminderLink(params: { phone: string | null; amount: number; dueSince: Date }): string | null {
  if (!params.phone) return null;
  const digits = params.phone.replace(/\D/g, "");
  if (digits.length < 10) return null;

  // Assume an Indian mobile number when no country code is present.
  const withCountryCode = digits.length === 10 ? `91${digits}` : digits;

  const message = `Bhaiya ye payment karwa dijiye. Invoice amount: ₹${formatInr(params.amount)} (Due since: ${formatDateDDMMYYYY(params.dueSince)})`;
  return `https://wa.me/${withCountryCode}?text=${encodeURIComponent(message)}`;
}
