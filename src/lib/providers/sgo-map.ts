// Pure mapping from a SportsGameOdds event to the app's odds shape (tested in
// logic.test.ts). Fetching lives in sgo.ts.
import { gameKey, parseAmerican, type Market, type OddsEvent, type Outcome } from "../lines.ts";

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
export type SgoEvent = {
  eventID: string;
  teams?: { home?: { names?: { long?: string } }; away?: { names?: { long?: string } } };
  status?: { startsAt?: string };
  players?: Record<string, { name?: string; firstName?: string; lastName?: string }>;
  odds?: Record<string, SgoOdd>;
};

// The three yardage props keep their original keys (legs already saved use
// them). Every other player stat DraftKings offers comes through as
// player_<statID>, e.g. player_receiving_receptions, player_firstTouchdown.
const PROP_STATS: Record<string, string> = {
  passing_yards: "player_pass_yds",
  rushing_yards: "player_rush_yds",
  receiving_yards: "player_reception_yds",
};

export function propKey(statID: string) {
  return PROP_STATS[statID] ?? `player_${statID.replace(/\+/g, "_").replace(/[^A-Za-z0-9_]/g, "")}`;
}

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
      const ou = (side === "over" || side === "under") && num(dk.overUnder) != null;
      if (bet === "ml" && team) add("h2h", { name: team, price });
      else if (bet === "sp" && team && num(dk.spread) != null) add("spreads", { name: team, price, point: num(dk.spread)! });
      else if (bet === "ou" && entity === "all" && ou) {
        add("totals", { name: side === "over" ? "Over" : "Under", price, point: num(dk.overUnder)! });
      } else if (bet === "ou" && ou) {
        // Team total: statEntityID is the team.
        add("team_total", { name: side === "over" ? "Over" : "Under", description: entity === "home" ? home : away, price, point: num(dk.overUnder)! });
      }
      continue;
    }
    if (entity === "home" || entity === "away" || entity === "all") continue; // other team/game specials

    // Player props: statEntityID is the player's ID.
    const pid = odd.playerID || entity;
    if (!pid || entity === "home" || entity === "away" || entity === "all") continue;
    const who = playerName(ev, pid);

    const statID = odd.statID ?? "";
    if (!statID) continue;
    if (statID === "touchdowns") {
      const anytime =
        (bet === "yn" && side === "yes") ||
        (bet === "ou" && side === "over" && num(dk.overUnder) === 0.5);
      if (anytime) {
        add("player_anytime_td", { name: "Yes", description: who, price });
        continue;
      }
      // 2+ TDs and the like fall through as Over/Under touchdowns.
    }
    const market = propKey(statID);
    if (bet === "ou" && (side === "over" || side === "under") && num(dk.overUnder) != null) {
      add(market, { name: side === "over" ? "Over" : "Under", description: who, price, point: num(dk.overUnder)! });
    } else if (bet === "yn" && side === "yes") {
      // First TD scorer, last TD scorer and other yes/no player props.
      add(market, { name: "Yes", description: who, price });
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

