/** Hermes has no crypto.randomUUID, and the ids only ever have to be unique
 *  inside one phone's database - time plus randomness is enough, and it sorts
 *  by creation order for free. */
export function uid(prefix = ""): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}${time}${rand}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}
