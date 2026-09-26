import "server-only";
import { db } from "./db";

// Everyone's Venmo, for paying the week's bookie. Handles are personal, so
// they never go in the code (the repo is public):
//  - VENMOS in Vercel seeds them: "userId=handle,userId=handle"
//  - anyone can set or change their own in the app (League tab, or when they
//    tap I placed it), and the admin can set anyone's. Those are saved in the
//    database and win over the seed.
// The admin's falls back to PAY_TO_VENMO.

const KEY = "venmo:";

export function cleanHandle(raw: string): string | null {
  const h = raw.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?venmo\.com\/(u\/)?/i, "").replace(/\/.*$/, "");
  return /^[A-Za-z0-9_-]{2,30}$/.test(h) ? h : null;
}

function seed(): Map<string, string> {
  const out = new Map<string, string>();
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

