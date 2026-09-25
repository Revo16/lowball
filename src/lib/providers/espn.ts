import "server-only";
import { gameKey, parseAmerican, type Market, type OddsEvent, type Outcome } from "../lines";

// ESPN's public scoreboard feed. No key, no quota. It carries DraftKings'
// spread, total and moneyline for each game, plus a DraftKings link per line
// that opens the sportsbook with that bet on the betslip.
// Unofficial and undocumented: if ESPN changes it, the app falls back to
// SportsGameOdds for game lines.

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

type EspnLine = { line?: string; odds?: string; link?: { href?: string } };
type EspnSide = { close?: EspnLine; open?: EspnLine };
type EspnOdds = {
  provider?: { name?: string };
  moneyline?: { home?: EspnSide; away?: EspnSide };
  pointSpread?: { home?: EspnSide; away?: EspnSide };
  total?: { over?: EspnSide; under?: EspnSide };
};
type EspnEvent = {
  id: string;
  date: string;
  competitions?: Array<{
    competitors?: Array<{ homeAway: "home" | "away"; team?: { displayName?: string } }>;
    odds?: EspnOdds[];
  }>;
};

function lineNumber(v?: string): number | null {
  if (v == null) return null;
  const n = Number(String(v).trim().replace(/^[ou]/i, "").replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
}

/** ESPN wraps DraftKings links in a tracking redirect; keep the real sportsbook URL. */
export function dkLink(href?: string): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href);
    const inner = u.searchParams.get("preurl");
    const target = new URL(inner ?? href);
    return target.hostname.endsWith("draftkings.com") ? target.toString() : undefined;
  } catch {
    return undefined;
  }
}

function outcome(name: string, side: EspnSide | undefined, withPoint: boolean): Outcome | null {
  const c = side?.close;
  const price = parseAmerican(c?.odds);
  if (price == null) return null;
  const o: Outcome = { name, price };
  if (withPoint) {
    const point = lineNumber(c?.line);
    if (point == null) return null;
    o.point = point;
  }
  const link = dkLink(c?.link?.href);
  if (link) o.link = link;
  return o;
}

export function mapEspnEvent(e: EspnEvent): OddsEvent | null {
  const c = e.competitions?.[0];
  const home = c?.competitors?.find((x) => x.homeAway === "home")?.team?.displayName;
  const away = c?.competitors?.find((x) => x.homeAway === "away")?.team?.displayName;
  if (!home || !away) return null;
  const dk = c?.odds?.find((o) => /draftkings/i.test(o.provider?.name ?? ""));
  const markets: Market[] = [];
  if (dk) {
    const ml = [outcome(away, dk.moneyline?.away, false), outcome(home, dk.moneyline?.home, false)];
    const sp = [outcome(away, dk.pointSpread?.away, true), outcome(home, dk.pointSpread?.home, true)];
    const tot = [outcome("Over", dk.total?.over, true), outcome("Under", dk.total?.under, true)];
    if (ml.every(Boolean)) markets.push({ key: "h2h", outcomes: ml as Outcome[] });
    if (sp.every(Boolean)) markets.push({ key: "spreads", outcomes: sp as Outcome[] });
    if (tot.every(Boolean)) markets.push({ key: "totals", outcomes: tot as Outcome[] });
  }
  return {
    id: gameKey(away, home),
    commence_time: new Date(e.date).toISOString(),
    home_team: home,
    away_team: away,
    bookmakers: markets.length ? [{ key: "draftkings", last_update: new Date().toISOString(), markets }] : [],
  };
}

export async function espnWeek(season: string, week: number): Promise<OddsEvent[]> {
  const url = `${SCOREBOARD}?seasontype=2&week=${week}&dates=${encodeURIComponent(season)}`;
  const res = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
  const body = (await res.json()) as { events?: EspnEvent[] };
  return (body.events ?? []).map(mapEspnEvent).filter((e): e is OddsEvent => !!e);
}
