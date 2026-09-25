import "server-only";
import { gameKey, parseAmerican, type Market, type OddsEvent, type Outcome } from "../lines";

// SportsGameOdds. Free "Amateur" plan: 2,500 objects a month, where one game
// is one object no matter how many markets come back. One call returns every
// DraftKings prop for every game in the window.
// Docs: https://sportsgameodds.com/docs  oddID = statID-statEntityID-periodID-betTypeID-sideID

const BASE = "https://api.sportsgameodds.com/v2/events";

type SgoBook = { odds?: string; overUnder?: string; spread?: string; available?: boolean };
type SgoOdd = {
  oddID?: string;
  statID?: string;
  statEntityID?: string;
  playerID?: string;
  periodID?: string;
  betTypeID?: string;
  sideID?: string;
  byBookmaker?: Record<string, SgoBook>;
};
type SgoEvent = {
  eventID: string;
  teams?: { home?: { names?: { long?: string } }; away?: { names?: { long?: string } } };
  status?: { startsAt?: string };
  players?: Record<string, { name?: string; firstName?: string; lastName?: string }>;
  odds?: Record<string, SgoOdd>;
};

const PROP_STATS: Record<string, string> = {
  passing_yards: "player_pass_yds",
  rushing_yards: "player_rush_yds",
  receiving_yards: "player_reception_yds",
};

function playerName(ev: SgoEvent, id: string) {
  const p = ev.players?.[id];
  const full = p?.name || [p?.firstName, p?.lastName].filter(Boolean).join(" ");
  if (full) return full;
  // IDs look like "JAXON_SMITHNJIGBA_1_NFL"; make something readable as a last resort.
  return id
    .replace(/_\d+_NFL$/i, "")
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

function num(v?: string) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
}

export function mapSgoEvent(ev: SgoEvent): OddsEvent | null {
  const home = ev.teams?.home?.names?.long;
  const away = ev.teams?.away?.names?.long;
  const startsAt = ev.status?.startsAt;
  if (!home || !away || !startsAt) return null;

  const markets = new Map<string, Outcome[]>();
  const add = (key: string, o: Outcome) => {
    if (!markets.has(key)) markets.set(key, []);
    markets.get(key)!.push(o);
  };

  for (const odd of Object.values(ev.odds ?? {})) {
    if ((odd.periodID ?? "game") !== "game") continue;
    const dk = odd.byBookmaker?.draftkings;
    if (!dk || dk.available === false) continue;
    const price = parseAmerican(dk.odds);
    if (price == null) continue;
    const entity = odd.statEntityID ?? "";
    const bet = odd.betTypeID;
    const side = odd.sideID;

    if (odd.statID === "points" && (entity === "home" || entity === "away" || entity === "all")) {
      const team = side === "home" ? home : side === "away" ? away : null;
      if (bet === "ml" && team) add("h2h", { name: team, price });
      else if (bet === "sp" && team && num(dk.spread) != null) add("spreads", { name: team, price, point: num(dk.spread)! });
      else if (bet === "ou" && entity === "all" && (side === "over" || side === "under") && num(dk.overUnder) != null) {
        add("totals", { name: side === "over" ? "Over" : "Under", price, point: num(dk.overUnder)! });
      }
      continue;
    }

    // Player props: statEntityID is the player's ID.
    const pid = odd.playerID || entity;
    if (!pid || entity === "home" || entity === "away" || entity === "all") continue;
    const who = playerName(ev, pid);

    if (odd.statID === "touchdowns") {
      const anytime =
        (bet === "yn" && side === "yes") ||
        (bet === "ou" && side === "over" && num(dk.overUnder) === 0.5);
      if (anytime) add("player_anytime_td", { name: "Yes", description: who, price });
      continue;
    }
    const market = PROP_STATS[odd.statID ?? ""];
    if (market && bet === "ou" && (side === "over" || side === "under") && num(dk.overUnder) != null) {
      add(market, { name: side === "over" ? "Over" : "Under", description: who, price, point: num(dk.overUnder)! });
    }
  }

  const list: Market[] = [...markets].map(([key, outcomes]) => ({ key, outcomes }));
  return {
    id: gameKey(away, home),
    commence_time: new Date(startsAt).toISOString(),
    home_team: home,
    away_team: away,
    bookmakers: list.length ? [{ key: "draftkings", last_update: new Date().toISOString(), markets: list }] : [],
  };
}

/** Every NFL game in the window with DraftKings odds. Returns objects used for budgeting. */
export async function sgoSlate(apiKey: string, from: Date, to: Date) {
  const events: OddsEvent[] = [];
  let objects = 0;
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const url = new URL(BASE);
    url.searchParams.set("leagueID", "NFL");
    url.searchParams.set("bookmakerID", "draftkings");
    url.searchParams.set("oddsAvailable", "true");
    url.searchParams.set("startsAfter", from.toISOString());
    url.searchParams.set("startsBefore", to.toISOString());
    url.searchParams.set("limit", "50");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { cache: "no-store", headers: { "X-Api-Key": apiKey } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SportsGameOdds returned ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
    }
    const body = (await res.json()) as { success?: boolean; data?: SgoEvent[]; nextCursor?: string; error?: string };
    if (body.success === false) throw new Error(`SportsGameOdds: ${body.error ?? "request failed"}`);
    const data = body.data ?? [];
    objects += data.length;
    for (const ev of data) {
      const mapped = mapSgoEvent(ev);
      if (mapped) events.push(mapped);
    }
    if (!body.nextCursor || !data.length) break;
    cursor = body.nextCursor;
  }
  return { events, objects };
}
