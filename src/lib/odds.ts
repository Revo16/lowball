import "server-only";
import { isPickable } from "./legrules";
import { db } from "./db";
import { flatten, gameKey, isPropMarket, PROP_MARKETS, GAME_MARKETS, type BoardLine, type OddsEvent } from "./lines";
import { espnWeek } from "./providers/espn";
import { sgoSlate } from "./providers/sgo";

export * from "./lines";

// Where odds come from:
//   Game lines (spread / total / moneyline): ESPN's free feed, every few minutes.
//   Player props: SportsGameOdds' free plan, refreshed as often as the monthly
//     allowance allows. The Odds API is an optional paid alternative.
// Everything is cached in Supabase and shared by the whole league, and nothing
// is fetched unless someone has the app open.

export type OddsWindow = { season: string; week: number; lock: Date; windowEnd: Date };

function num(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const ESPN_TTL = num("ESPN_TTL_MIN", 5);
const SGO_MONTHLY = num("SGO_MONTHLY_OBJECTS", 2500);
const SGO_RESERVE = num("SGO_RESERVE_OBJECTS", 50);
const SGO_MIN_REFRESH = num("SGO_MIN_REFRESH_MIN", 30);
const ODDSAPI_PROP_TTL = num("ODDS_SEARCH_TTL_MIN", 240);

const sgoKey = () => process.env.SGO_API_KEY ?? "";
const oddsApiKey = () => process.env.ODDS_API_KEY ?? "";

export function propsSource(): "sportsgameodds" | "the-odds-api" | null {
  if (sgoKey()) return "sportsgameodds";
  if (oddsApiKey()) return "the-odds-api";
  return null;
}

/** Game lines always work (ESPN needs no key). */
export function oddsEnabled() {
  return true;
}

/* ---------------- cache ---------------- */

type Cached<T> = { data: T; fetchedAt: Date; stale: boolean };
const inflight = new Map<string, Promise<unknown>>();

async function readCache(key: string) {
  const r = await db().from("odds_cache").select("payload, fetched_at").eq("key", key).maybeSingle();
  return (r.data as { payload: unknown; fetched_at: string } | null) ?? null;
}

async function writeCache(key: string, payload: unknown) {
  await db().from("odds_cache").upsert({ key, payload, fetched_at: new Date().toISOString() });
}

async function cached<T>(key: string, ttlMin: number, load: () => Promise<T>): Promise<Cached<T>> {
  const hit = await readCache(key);
  const age = hit ? Date.now() - new Date(hit.fetched_at).getTime() : Infinity;
  if (hit && age < ttlMin * 60_000) return { data: hit.payload as T, fetchedAt: new Date(hit.fetched_at), stale: false };
  // A dozen phones polling at once should cost one call, not twelve.
  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load()
      .then(async (data) => {
        await writeCache(key, data);
        return data;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  try {
    return { data: await p, fetchedAt: new Date(), stale: false };
  } catch (err) {
    if (hit) return { data: hit.payload as T, fetchedAt: new Date(hit.fetched_at), stale: true };
    throw err;
  }
}

// A game is on the board until 15 minutes before kickoff (Thursday games
// included), through the end of the week.
function inWindow(e: OddsEvent, w: OddsWindow) {
  return isPickable(e.commence_time) && new Date(e.commence_time).getTime() < w.windowEnd.getTime();
}

/** Tuesday 00:00 PT that opens the week. */
function weekStart(w: OddsWindow) {
  return new Date(w.windowEnd.getTime() - 7 * 86_400_000);
}

function onlyMarkets(e: OddsEvent, keys: readonly string[]): OddsEvent {
  return {
    ...e,
    bookmakers: e.bookmakers.map((b) => ({ ...b, markets: b.markets.filter((m) => keys.includes(m.key)) })),
  };
}

function hasMarkets(e: OddsEvent) {
  return e.bookmakers.some((b) => b.markets.length > 0);
}

/* ---------------- SportsGameOdds budget ---------------- */

function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

export async function sgoUsage() {
  const row = await readCache("meta:sgo-usage");
  const p = (row?.payload ?? {}) as { month?: string; used?: number; slate?: number };
  const used = p.month === monthKey() ? p.used ?? 0 : 0;
  return { used, monthly: SGO_MONTHLY, remaining: Math.max(0, SGO_MONTHLY - used), slate: p.slate ?? 16 };
}

async function recordSgoUsage(objects: number, slate: number) {
  const u = await sgoUsage();
  await writeCache("meta:sgo-usage", { month: monthKey(), used: u.used + objects, slate: slate || u.slate });
}

/**
 * How long a props snapshot stays fresh. Spreads the month's remaining
 * allowance evenly over the days left, so quiet days bank credits for busy ones.
 */
export async function sgoRefreshMinutes() {
  const u = await sgoUsage();
  const spendable = u.remaining - SGO_RESERVE;
  if (spendable < u.slate) return Infinity;
  const now = new Date();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysLeft = daysInMonth - now.getUTCDate() + 1;
  const fetchesPerDay = spendable / daysLeft / u.slate;
  return Math.min(1440, Math.max(SGO_MIN_REFRESH, Math.round(1440 / fetchesPerDay)));
}

/* ---------------- The Odds API (optional, paid) ---------------- */

const ODDSAPI = "https://api.the-odds-api.com/v4/sports/americanfootball_nfl";

async function oddsApiCall<T>(url: URL): Promise<T> {
  url.searchParams.set("apiKey", oddsApiKey());
  const res = await fetch(url, { cache: "no-store" });
  const remaining = res.headers.get("x-requests-remaining");
  if (remaining != null) await writeCache("meta:credits", { remaining: Number(remaining) });
  if (!res.ok) throw new Error(`The Odds API returned ${res.status}`);
  return res.json() as Promise<T>;
}

async function oddsApiProps(w: OddsWindow): Promise<OddsEvent[]> {
  // Listing events is free; props cost 1 credit per market per game.
  const list = await cached(`oddsapi:events:${w.season}:${w.week}`, 60, () => {
    const url = new URL(`${ODDSAPI}/events`);
    url.searchParams.set("commenceTimeFrom", new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
    url.searchParams.set("commenceTimeTo", w.windowEnd.toISOString().replace(/\.\d{3}Z$/, "Z"));
    return oddsApiCall<Array<{ id: string; commence_time: string; home_team: string; away_team: string }>>(url);
  });
  const out: OddsEvent[] = [];
  for (const e of list.data) {
    const r = await cached(`oddsapi:props:${e.id}`, ODDSAPI_PROP_TTL, () => {
      const url = new URL(`${ODDSAPI}/events/${e.id}/odds`);
      url.searchParams.set("regions", "us");
      url.searchParams.set("bookmakers", "draftkings");
      url.searchParams.set("markets", PROP_MARKETS.join(","));
      url.searchParams.set("oddsFormat", "american");
      return oddsApiCall<OddsEvent>(url);
    }).catch(() => null);
    if (r) out.push({ ...r.data, id: gameKey(e.away_team, e.home_team) });
  }
  return out;
}

/* ---------------- public ---------------- */

export type PropSlate = { events: OddsEvent[]; fetchedAt: Date | null; stale: boolean; error: string | null };

/** Every DraftKings player prop for games still open for picks. */
export async function propSlate(w: OddsWindow): Promise<PropSlate> {
  const source = propsSource();
  if (!source) return { events: [], fetchedAt: null, stale: false, error: null };
  try {
    if (source === "sportsgameodds") {
      const ttl = await sgoRefreshMinutes();
      const r = await cached(`sgo:${w.season}:${w.week}`, ttl, async () => {
        if (!Number.isFinite(ttl)) throw new Error("This month's free SportsGameOdds allowance is used up");
        const s = await sgoSlate(sgoKey(), weekStart(w), w.windowEnd);
        await recordSgoUsage(s.objects, s.events.length);
        return s.events;
      });
      return { events: r.data.filter((e) => inWindow(e, w)), fetchedAt: r.fetchedAt, stale: r.stale, error: null };
    }
    const events = await oddsApiProps(w);
    return { events: events.map((e) => onlyMarkets(e, PROP_MARKETS)), fetchedAt: new Date(), stale: false, error: null };
  } catch (err) {
    return { events: [], fetchedAt: null, stale: false, error: (err as Error).message };
  }
}

/** Spread, total and moneyline for every game still open for picks. */
export async function gameOdds(w: OddsWindow) {
  try {
    const r = await cached(`espn:${w.season}:${w.week}`, ESPN_TTL, () => espnWeek(w.season, w.week));
    const events = r.data.filter((e) => inWindow(e, w) && hasMarkets(e));
    if (events.length || !propsSource()) {
      return {
        events: events.sort((a, b) => a.commence_time.localeCompare(b.commence_time)),
        fetchedAt: r.fetchedAt,
        stale: r.stale,
        source: "espn" as const,
      };
    }
  } catch {
    /* fall through to SportsGameOdds */
  }
  // ESPN down or missing lines: SportsGameOdds carries game lines too.
  const p = await propSlate(w);
  if (p.error && !p.events.length) throw new Error(p.error);
  const events = p.events
    .map((e) => onlyMarkets(e, GAME_MARKETS))
    .filter(hasMarkets)
    .sort((a, b) => a.commence_time.localeCompare(b.commence_time));
  return { events, fetchedAt: p.fetchedAt, stale: p.stale, source: "sportsgameodds" as const };
}

/** Props for one game, from the shared slate. */
export async function eventProps(w: OddsWindow, eventId: string) {
  const p = await propSlate(w);
  const event = p.events.find((e) => e.id === eventId);
  return event ? { event, fetchedAt: p.fetchedAt, stale: p.stale } : null;
}

/** Every prop line, flattened for search. */
export async function allProps(w: OddsWindow): Promise<{ lines: BoardLine[]; fetchedAt: Date | null; error: string }> {
  const p = await propSlate(w);
  // Every non-game market the feed has for DraftKings: all player props, team totals.
  return { lines: p.events.flatMap((e) => flatten(e).filter((l) => isPropMarket(l.market))), fetchedAt: p.fetchedAt, error: p.error ?? "" };
}

/** For the bookie console. */
export async function oddsStatus() {
  const source = propsSource();
  if (source === "sportsgameodds") {
    const [u, ttl] = await Promise.all([sgoUsage(), sgoRefreshMinutes()]);
    return {
      source,
      text: Number.isFinite(ttl)
        ? `Props: ${u.used.toLocaleString()} of ${u.monthly.toLocaleString()} free SportsGameOdds games used this month. Refreshing about every ${ttl >= 120 ? `${Math.round(ttl / 60)} hours` : `${Math.max(1, Math.round(ttl))} minutes`}.`
        : `Props: this month's free SportsGameOdds allowance is used up. Showing the last prices until the 1st.`,
    };
  }
  if (source === "the-odds-api") {
    const row = await readCache("meta:credits");
    const rem = (row?.payload as { remaining?: number } | undefined)?.remaining;
    return { source, text: `Props: The Odds API${rem != null ? `, ${rem.toLocaleString()} credits left` : ""}.` };
  }
  return { source, text: "Props: off. Add SGO_API_KEY (free) to turn on player prop search." };
}
