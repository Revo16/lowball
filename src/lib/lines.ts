// Pure helpers for DraftKings lines: labels, flattening, live price lookup,
// and the "can two people take this" rule. No imports, so they run in tests
// and in the browser.

export type Outcome = { name: string; description?: string; price: number; point?: number; link?: string };
export type Market = { key: string; outcomes: Outcome[] };
export type OddsEvent = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{ key: string; last_update: string; markets: Market[] }>;
};

export const GAME_MARKETS = ["spreads", "h2h", "totals"] as const;
export const PROP_MARKETS = [
  "player_anytime_td",
  "player_pass_yds",
  "player_rush_yds",
  "player_reception_yds",
] as const;

export const MARKET_LABEL: Record<string, string> = {
  h2h: "Moneyline",
  spreads: "Spread",
  totals: "Total",
  player_anytime_td: "Anytime TD",
  player_pass_yds: "Passing yards",
  player_rush_yds: "Rushing yards",
  player_reception_yds: "Receiving yards",
  custom: "Custom",
};

/** A single tappable line, flattened for search. */
export type BoardLine = {
  key: string;
  eventId: string;
  game: string;
  commence: string;
  market: string;
  name: string;
  desc: string;
  point: number | null;
  price: number;
  label: string;
  link: string | null;
};

export function dkMarkets(event: OddsEvent): Market[] {
  return event.bookmakers.find((b) => b.key === "draftkings")?.markets ?? [];
}

export function gameLabel(e: Pick<OddsEvent, "away_team" | "home_team">) {
  return `${e.away_team} @ ${e.home_team}`;
}

/**
 * One id per game across every odds source: "falcons-at-packers".
 * NFL nicknames are unique, and sources disagree on city names.
 */
export function gameKey(away: string, home: string) {
  const nick = (t: string) => shortTeam(t).toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${nick(away)}-at-${nick(home)}`;
}

/** "-110", "+240", "EVEN" -> number. */
export function parseAmerican(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  if (s === "EVEN" || s === "EV") return 100;
  const n = Number(s.replace(/^\+/, ""));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null;
}

export function shortTeam(name: string) {
  // "Seattle Seahawks" -> "Seahawks"
  return name.split(" ").slice(-1)[0];
}

function signed(n: number) {
  return n > 0 ? `+${n}` : `${n}`;
}

/** How the bookie will read the pick when building the bet. */
export function selectionLabel(market: string, o: Pick<Outcome, "name" | "description" | "point">): string {
  switch (market) {
    case "h2h":
      return `${shortTeam(o.name)} ML`;
    case "spreads":
      return `${shortTeam(o.name)} ${signed(o.point ?? 0)}`;
    case "totals":
      return `${o.name} ${o.point}`;
    case "player_anytime_td":
      return `${o.description} anytime TD`;
    default: {
      const stat = MARKET_LABEL[market]?.toLowerCase() ?? market;
      return `${o.description} ${o.name} ${o.point} ${stat}`;
    }
  }
}

export function lineKey(eventId: string, market: string, name: string, desc: string, point: number | null) {
  return [eventId, market, name, desc, point ?? ""].join("|");
}

export function flatten(event: OddsEvent, only?: readonly string[]): BoardLine[] {
  const game = gameLabel(event);
  const out: BoardLine[] = [];
  for (const m of dkMarkets(event)) {
    if (only && !only.includes(m.key)) continue;
    for (const o of m.outcomes) {
      const desc = o.description ?? "";
      const point = o.point ?? null;
      out.push({
        key: lineKey(event.id, m.key, o.name, desc, point),
        eventId: event.id,
        game,
        commence: event.commence_time,
        market: m.key,
        name: o.name,
        desc,
        point,
        price: o.price,
        label: selectionLabel(m.key, o),
        link: o.link ?? null,
      });
    }
  }
  return out;
}

export type LivePrice =
  | { status: "live"; price: number; point: number | null }
  | { status: "moved"; price: number; point: number | null; label: string }
  | { status: "gone" };

/**
 * What DraftKings shows right now for a leg someone already picked.
 * "moved" means the main line shifted (e.g. -2.5 became -3); the old number
 * still exists on DraftKings as an alternate line at a different price.
 */
export function currentPrice(
  leg: { market: string; outcome_name: string | null; outcome_desc: string | null; point: number | null },
  markets: Market[],
): LivePrice {
  const m = markets.find((x) => x.key === leg.market);
  if (!m) return { status: "gone" };
  const same = m.outcomes.filter(
    (o) => o.name === leg.outcome_name && (o.description ?? "") === (leg.outcome_desc ?? ""),
  );
  if (!same.length) return { status: "gone" };
  const want = leg.point == null ? null : Number(leg.point);
  const exact = same.find((o) => (o.point ?? null) === want);
  if (exact) return { status: "live", price: exact.price, point: exact.point ?? null };
  const nearest = [...same].sort(
    (a, b) => Math.abs((a.point ?? 0) - (want ?? 0)) - Math.abs((b.point ?? 0) - (want ?? 0)),
  )[0];
  return {
    status: "moved",
    price: nearest.price,
    point: nearest.point ?? null,
    label: selectionLabel(leg.market, nearest),
  };
}

export type LegLite = { userId: string; eventId: string | null; market: string; desc: string | null };

/**
 * DraftKings won't take both sides (or two versions) of the same game line in
 * one parlay, and the same player-stat twice is redundant. Returns the leg that
 * blocks this pick, if any.
 */
export function conflictFor(c: { eventId: string | null; market: string; desc: string | null }, others: LegLite[]) {
  if (!c.eventId) return null;
  const isProp = c.market.startsWith("player_");
  return (
    others.find(
      (l) =>
        l.eventId === c.eventId &&
        l.market === c.market &&
        (!isProp || (l.desc ?? "") === (c.desc ?? "")),
    ) ?? null
  );
}

/** DraftKings outcome ids in a betslip link (?outcomes=a+b). */
export function dkOutcomeIds(link: string): string[] {
  try {
    const u = new URL(link);
    // URLSearchParams turns "+" into a space, so split on both.
    return (u.searchParams.get("outcomes") ?? "").split(/[ +]/).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * One DraftKings link that loads every leg onto the betslip at once.
 * DraftKings' own format is ?outcomes=id1+id2+id3.
 */
export function dkParlayLink(links: Array<string | null | undefined>): string | null {
  const valid = links.filter((l): l is string => !!l && dkOutcomeIds(l).length > 0);
  if (!valid.length) return null;
  const ids = [...new Set(valid.flatMap(dkOutcomeIds))];
  const base = new URL(valid[0]);
  return `${base.origin}${base.pathname}?outcomes=${ids.join("+")}`;
}
