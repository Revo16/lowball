import "server-only";
import { getLegs, getParlay } from "./db";
import { seasonNow } from "./season";
import { expectedPickers } from "./jobs";
import { gameOdds, allProps, flatten, lineKey, oddsEnabled, propsSource, GAME_MARKETS, type BoardLine } from "./odds";
import type { Member } from "./sleeper";

// What Find a bet needs. Game lines come with the page; props load on demand
// the first time someone searches, then everyone shares the cached copy.

export type BoardGame = { eventId: string; game: string; away: string; home: string; commence: string; lines: BoardLine[] };
export type BoardLeg = {
  userId: string;
  teamName: string;
  eventId: string | null;
  market: string;
  desc: string | null;
  key: string | null;
  selection: string;
  price: number | null;
};

export type BoardData = {
  week: number;
  lock: string;
  locked: boolean;
  canPick: boolean;
  isAdmin: boolean;
  forOther: boolean;
  canRemove: boolean;
  meId: string;
  target: { userId: string; teamName: string };
  people: Array<{ userId: string; teamName: string; picked: boolean }>;
  games: BoardGame[];
  legs: BoardLeg[];
  oddsEnabled: boolean;
  propsEnabled: boolean;
  oddsAt: string | null;
  oddsNote: string | null;
};

export async function boardLegs(all: Member[]) {
  const now = await seasonNow();
  const byId = new Map(all.map((m) => [m.userId, m]));
  const legs = await getLegs(now.season, now.week);
  return legs.map<BoardLeg>((l) => ({
    userId: l.user_id,
    teamName: byId.get(l.user_id)?.teamName ?? "Someone",
    eventId: l.event_id,
    market: l.market,
    desc: l.outcome_desc,
    key: l.event_id ? lineKey(l.event_id, l.market, l.outcome_name ?? "", l.outcome_desc ?? "", l.point == null ? null : Number(l.point)) : null,
    selection: l.selection,
    price: l.price,
  }));
}

export async function boardData(me: Member, all: Member[], forUser?: string): Promise<BoardData> {
  const now = await seasonNow();
  // Anyone can enter a leg for a pool member who has none (the person placing
  // it often collects picks by text). Only the admin can change an existing one.
  const target = forUser ? all.find((m) => m.userId === forUser) ?? me : me;
  const [legs, pickers] = await Promise.all([boardLegs(all), expectedPickers(now.season, now.week, all)]);

  let games: BoardGame[] = [];
  let oddsAt: string | null = null;
  let oddsNote: string | null = null;
  try {
    const g = await gameOdds(now);
    games = g.events.map((e) => ({
      eventId: e.id,
      game: `${e.away_team} @ ${e.home_team}`,
      away: e.away_team,
      home: e.home_team,
      commence: e.commence_time,
      lines: flatten(e, GAME_MARKETS),
    }));
    oddsAt = g.fetchedAt ? new Date(g.fetchedAt).toISOString() : null;
    if (g.stale) oddsNote = "The odds feed is lagging, so these are the last prices we got.";
  } catch (err) {
    oddsNote = `Couldn't load DraftKings lines (${(err as Error).message}). You can still add a bet by hand.`;
  }

  const picked = new Set(legs.map((l) => l.userId));
  const isPicker = pickers.some((p) => p.userId === target.userId);
  const parlay = await getParlay(now.season, now.week);
  const placed = !!parlay && parlay.status !== "open";
  const forOther = target.userId !== me.userId;
  const targetHasLeg = picked.has(target.userId);
  const canPick =
    !placed &&
    (me.isAdmin ||
      (forOther ? isPicker && !targetHasLeg : isPicker && !now.locked));
  const canRemove = !placed && (me.isAdmin || (!forOther && isPicker && !now.locked));
  return {
    week: now.week,
    lock: now.lock.toISOString(),
    locked: now.locked,
    canPick,
    isAdmin: me.isAdmin,
    forOther,
    canRemove,
    meId: me.userId,
    target: { userId: target.userId, teamName: target.teamName },
    people: me.isAdmin ? all.map((m) => ({ userId: m.userId, teamName: m.teamName, picked: picked.has(m.userId) })) : [],
    games,
    legs,
    oddsEnabled: oddsEnabled(),
    propsEnabled: !!propsSource(),
    oddsAt,
    oddsNote,
  };
}

/** Every player prop in the window, for search. */
export async function boardProps() {
  const now = await seasonNow();
  const p = await allProps(now);
  return {
    props: p.lines,
    propsAt: p.fetchedAt ? p.fetchedAt.toISOString() : null,
    error: p.error && !p.lines.length ? p.error : null,
  };
}
