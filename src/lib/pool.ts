import "server-only";
import { db } from "./db";

// Who's playing this season. Only pool members pick legs and can finish last.
// Nobody in the table at all = everyone in the league is in.

export async function poolIds(): Promise<Set<string> | null> {
  const r = await db().from("pool").select("user_id, active");
  if (r.error) throw new Error(`Database error: ${r.error.message}`);
  const rows = (r.data ?? []) as Array<{ user_id: string; active: boolean }>;
  if (!rows.length) return null;
  return new Set(rows.filter((x) => x.active).map((x) => x.user_id));
}

export async function setInPool(userId: string, active: boolean) {
  const res = await db().from("pool").upsert({ user_id: userId, active, updated_at: new Date().toISOString() });
  if (res.error) throw new Error(`Couldn't update the pool: ${res.error.message}`);
}
