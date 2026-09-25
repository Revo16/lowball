import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export type Leg = {
  id: string;
  season: string;
  week: number;
  user_id: string;
  event_id: string | null;
  commence_time: string | null;
  game: string;
  market: string;
  selection: string;
  outcome_name: string | null;
  outcome_desc: string | null;
  point: number | null;
  price: number | null;
  dk_link: string | null;
  entered_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Loser = {
  season: string;
  week: number;
  user_id: string;
  points: number;
  tied: boolean;
  paid: boolean;
  confirmed: boolean;
  paid_at: string | null;
};

export type Parlay = {
  season: string;
  week: number;
  status: "open" | "placed" | "won" | "lost" | "void";
  dk_odds: number | null;
  stake: number | null;
  payout: number | null;
  note: string | null;
  placed_by: string | null;
  placed_at: string | null;
  settled_at: string | null;
};

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data;
}

export async function getLegs(season: string, week: number): Promise<Leg[]> {
  return check(
    await db().from("legs").select("*").eq("season", season).eq("week", week).order("created_at"),
  ) as Leg[];
}

export async function getLosers(season: string): Promise<Loser[]> {
  return check(
    await db().from("losers").select("*").eq("season", season).order("week", { ascending: false }),
  ) as Loser[];
}

export async function getParlay(season: string, week: number): Promise<Parlay | null> {
  const rows = check(
    await db().from("parlays").select("*").eq("season", season).eq("week", week).limit(1),
  ) as Parlay[];
  return rows[0] ?? null;
}

export async function getParlays(season: string): Promise<Parlay[]> {
  return check(
    await db().from("parlays").select("*").eq("season", season).order("week", { ascending: false }),
  ) as Parlay[];
}

/** Returns true the first time a key is claimed, false if it was already sent. */
export async function claimMessage(key: string): Promise<boolean> {
  const res = await db().from("sent_messages").insert({ key });
  if (!res.error) return true;
  if (res.error.code === "23505") return false; // unique violation: already sent
  throw new Error(`Database error: ${res.error.message}`);
}

export async function releaseMessage(key: string): Promise<void> {
  await db().from("sent_messages").delete().eq("key", key);
}
