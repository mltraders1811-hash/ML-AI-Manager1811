// Broker normalization rules, ported from khaata's backend/server.py.
// Kept as data (not hardcoded per-call) so a shop with different broker
// nicknames can extend BROKER_MAP without touching the parser.

export const BROKERAGE_RATE = 0.005; // 0.5%

export const BROKER_MAP: Record<string, string> = {
  tota: "Tota",
  rajesh: "Rajesh",
  pinky: "Pinky",
  naresh: "Naresh",
  jojo: "Jojo",
  "jo.jo": "Jojo",
  bitu: "Bittu",
  bittu: "Bittu",
  anu: "Annu",
  annu: "Annu",
};

// Canonical broker display order.
export const BROKER_ORDER = ["Tota", "Rajesh", "Pinky", "Naresh", "Jojo", "Bittu", "Annu"];
export const SHOP_OWN_NAME = "Shop Own Sale";

/**
 * - Empty/NaN -> "Shop Own Sale" (no brokerage)
 * - Known code -> canonical display name (e.g. "tota" -> "Tota")
 * - Anything else -> the exact name written in the Bro. column (trimmed only)
 */
export function normalizeBroker(raw: unknown): { name: string; isShopOwn: boolean } {
  if (raw === null || raw === undefined) return { name: SHOP_OWN_NAME, isShopOwn: true };
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === "nan") return { name: SHOP_OWN_NAME, isShopOwn: true };

  // Lookup key: lowercase + strip surrounding punctuation/dots (matching only).
  const key = s.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  const mapped = BROKER_MAP[key];
  if (mapped) return { name: mapped, isShopOwn: false };

  // Unknown broker - keep the name AS WRITTEN, only trimming surrounding
  // whitespace/punctuation so ".naresh" doesn't read as different from "naresh".
  const cleaned = s.replace(/^[^\w]+|[^\w]+$/g, "");
  return { name: cleaned || s, isShopOwn: false };
}

/** Canonical brokers first (in defined order), then unknown brokers
 * (alphabetical), then Shop Own Sale last. */
export function orderBrokers<T>(brokersByName: Record<string, T>): T[] {
  const ordered: T[] = [];
  for (const name of BROKER_ORDER) {
    const b = brokersByName[name];
    if (b) ordered.push(b);
  }
  const used = new Set<string>([...BROKER_ORDER, SHOP_OWN_NAME]);
  const unknownKeys = Object.keys(brokersByName)
    .filter((k) => !used.has(k))
    .sort();
  for (const k of unknownKeys) ordered.push(brokersByName[k]!);
  const shopOwn = brokersByName[SHOP_OWN_NAME];
  if (shopOwn) ordered.push(shopOwn);
  return ordered;
}
