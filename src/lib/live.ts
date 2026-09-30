import "server-only";
import { gameKey } from "./lines";
import { gradeLeg, isGradable, normName, type Box, type Grade, type LiveGame, type PlayerStats } from "./grade";
import type { Leg } from "./db";

// Live scores and box scores from ESPN's public feeds (no key, no quota):
//  - scoreboard: every game's score, clock and status
//  - summary?event=ID: the box score (every player's stats) and scoring plays
// Cached briefly in memory so a dozen phones polling The Slip cost a handful of
// ESPN calls, not hundreds.

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary";

const memo = new Map<string, { at: number; ttl: number; value: unknown }>();
async function cachedJson<T>(url: string, ttlSec: number): Promise<T> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < hit.ttl * 1000) return hit.value as T;
  const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
  const value = (await res.json()) as T;
  memo.set(url, { at: Date.now(), ttl: ttlSec, value });
  return value;
}

type EspnCompetitor = { homeAway: "home" | "away"; score?: string; team?: { displayName?: string; abbreviation?: string } };
type EspnStatus = { type?: { state?: string; detail?: string; shortDetail?: string; completed?: boolean } };
type EspnScoreEvent = {
  id: string;
  status?: EspnStatus;
  competitions?: Array<{ competitors?: EspnCompetitor[]; status?: EspnStatus }>;
};

export type LiveEntry = { espnId: string; game: LiveGame };

/** gameKey ("seahawks-at-cardinals") -> score, clock, status for the week. */
export async function liveWeek(season: string, week: number): Promise<Map<string, LiveEntry>> {
  const url = `${SCOREBOARD}?seasontype=2&week=${week}&dates=${encodeURIComponent(season)}`;
  const body = await cachedJson<{ events?: EspnScoreEvent[] }>(url, 30);
  const out = new Map<string, LiveEntry>();
  for (const e of body.events ?? []) {
    const c = e.competitions?.[0];
    const home = c?.competitors?.find((x) => x.homeAway === "home");
    const away = c?.competitors?.find((x) => x.homeAway === "away");
    if (!home?.team?.displayName || !away?.team?.displayName) continue;
    const st = e.status?.type ?? c?.status?.type;
    const state = st?.state === "in" ? "in" : st?.state === "post" || st?.completed ? "post" : "pre";
    out.set(gameKey(away.team.displayName, home.team.displayName), {
      espnId: e.id,
      game: {
        state,
        detail: st?.shortDetail ?? st?.detail ?? "",
        home: { name: home.team.displayName, abbr: home.team.abbreviation ?? "", score: Number(home.score ?? 0) || 0 },
        away: { name: away.team.displayName, abbr: away.team.abbreviation ?? "", score: Number(away.score ?? 0) || 0 },
      },
    });
  }
  return out;
}

type EspnStatGroup = { name?: string; keys?: string[]; athletes?: Array<{ athlete?: { displayName?: string }; stats?: string[] }> };
type EspnSummary = {
  boxscore?: { players?: Array<{ statistics?: EspnStatGroup[] }> };
  scoringPlays?: Array<{ text?: string; type?: { text?: string; abbreviation?: string }; scoringType?: { abbreviation?: string; name?: string } }>;
};

/** "18/25" under "completions/passingAttempts" gives both numbers; "2-14" under "sacks-sackYardsLost" too. */
function splitStat(key: string, raw: string): Array<[string, number]> {
  const keys = key.split(/[/-]/);
  const vals = keys.length > 1 ? raw.split(/[/-]/) : [raw];
  return keys.map((k, i) => [k, Number(vals[i] ?? NaN)] as [string, number]).filter(([, v]) => Number.isFinite(v));
}

export function parseBox(body: EspnSummary): Box {
  const players = new Map<string, PlayerStats>();
  for (const team of body.boxscore?.players ?? []) {
    for (const group of team.statistics ?? []) {
      const keys = group.keys ?? [];
      for (const a of group.athletes ?? []) {
        const name = a.athlete?.displayName;
        if (!name) continue;
        const id = normName(name);
        const stats = players.get(id) ?? {};
        (a.stats ?? []).forEach((raw, i) => {
          if (!keys[i]) return;
          for (const [k, v] of splitStat(keys[i], raw)) stats[`${group.name}.${k}`] = v;
        });
        players.set(id, stats);
      }
    }
  }
  // First touchdown scorer: the first TD in the scoring plays. "Kenneth Walker III 12 Yd Run (Myers Kick)".
  let firstTd: string | null = null;
  const plays = body.scoringPlays;
  if (plays) {
    const td = plays.find((p) => (p.scoringType?.abbreviation ?? p.type?.abbreviation ?? "").toUpperCase() === "TD" || /touchdown/i.test(p.scoringType?.name ?? p.type?.text ?? ""));
    const who = td?.text?.match(/^(.+?)\s+\d+\s+Yd/i)?.[1];
    if (who) firstTd = normName(who);
  }
  return { players, firstTd: plays ? firstTd : undefined };
}

export async function gameBox(espnId: string, state: LiveGame["state"]): Promise<Box | null> {
  if (state === "pre") return null;
  try {
    const body = await cachedJson<EspnSummary>(`${SUMMARY}?event=${espnId}`, state === "in" ? 30 : 1800);
    return parseBox(body);
  } catch {
    return null;
  }
}

export type LegLive = Grade & { game: LiveGame | null };

/** Every leg on the slip, graded against its game right now. */
export async function gradeLegs(season: string, week: number, legs: Leg[]): Promise<Map<string, LegLive>> {
  const out = new Map<string, LegLive>();
  if (!legs.length) return out;
  let games: Map<string, LiveEntry>;
  try {
    games = await liveWeek(season, week);
  } catch {
    return out;
  }
  const boxes = new Map<string, Promise<Box | null>>();
  const boxFor = (e: LiveEntry) => {
    if (!boxes.has(e.espnId)) boxes.set(e.espnId, gameBox(e.espnId, e.game.state));
    return boxes.get(e.espnId)!;
  };
  await Promise.all(
    legs.map(async (l) => {
      const entry = l.event_id ? games.get(l.event_id) ?? null : null;
      const needsBox = l.market.startsWith("player_");
      const box = entry && needsBox ? await boxFor(entry) : null;
      const g = gradeLeg(
        { market: l.market, outcome_name: l.outcome_name, outcome_desc: l.outcome_desc, point: l.point == null ? null : Number(l.point) },
        entry?.game ?? null,
        box,
      );
      out.set(l.id, { ...g, manual: g.manual || !isGradable(l.market), game: entry?.game ?? null });
    }),
  );
  return out;
}
