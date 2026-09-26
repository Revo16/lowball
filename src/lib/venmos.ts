import "server-only";
import { db } from "./db";

// Everyone's Venmo, for paying the week's bookie. Where a handle comes from,
// last one wins:
//  1. DEFAULT_VENMOS below (the pool, keyed by Sleeper user id)
//  2. VENMOS in Vercel, "userId=handle,userId=handle" (optional overrides)
//  3. What people save in the app: their own on the League tab or when they tap
//     I placed it, or anyone's by the admin (stored in the database)
// The admin's falls back to PAY_TO_VENMO.

const DEFAULT_VENMOS: Record<string, string> = {
  "1022603316649414656": "varun-neti", // 4KTREY NUTTR
  "565349860547133440": "iananderson13", // Need for Shaheed
  "1067937915054952448": "colby-biesold", // oy vey my ACL
  "1065164963234271232": "ryanrobinson9", // The Hogfather
  "1128911101363654656": "ktak49", // Slippin' Tony
  "1065765604533145600": "zach-smith-288", // tobiechip
};

const KEY = "venmo:";

export function cleanHandle(raw: string): string | null {
  const h = raw.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?venmo\.com\/(u\/)?/i, "").replace(/\/.*$/, "");
  return /^[A-Za-z0-9_-]{2,30}$/.test(h) ? h : null;
}

function seed(): Map<string, string> {
  const out = new Map<string, string>(Object.entries(DEFAULT_VENMOS));
  for (const pair of (process.env.VENMOS ?? "").split(/[,\n]/)) {
    const [id, handle] = pair.split("=").map((s) => s?.trim());
    const h = handle ? cleanHandle(handle) : null;
    if (id && h) out.set(id, h);
  }
  return out;
}

/** userId -> Venmo handle (no @). */
export async function venmos(adminUserId?: string | null): Promise<Map<string, string>> {
  const out = seed();
  if (adminUserId && !out.has(adminUserId)) {
    const own = cleanHandle(process.env.PAY_TO_VENMO ?? "");
    if (own) out.set(adminUserId, own);
  }
  // Saved in the app: stored in the key/value cache table so no new table is needed.
  const r = await db().from("odds_cache").select("key, payload").like("key", `${KEY}%`);
  for (const row of (r.data ?? []) as Array<{ key: string; payload: { handle?: string } }>) {
    const h = row.payload?.handle ? cleanHandle(row.payload.handle) : null;
    if (h) out.set(row.key.slice(KEY.length), h);
  }
  return out;
}

export async function venmoFor(userId: string, adminUserId?: string | null) {
  return (await venmos(adminUserId)).get(userId) ?? null;
}

export async function saveVenmo(userId: string, raw: string) {
  const h = cleanHandle(raw);
  if (!h) throw new Error("That doesn't look like a Venmo username. It's the part after @, like your-name-123.");
  const res = await db().from("odds_cache").upsert({ key: `${KEY}${userId}`, payload: { handle: h }, fetched_at: new Date().toISOString() });
  if (res.error) throw new Error(`Couldn't save it: ${res.error.message}`);
  return h;
}

