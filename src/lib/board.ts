import "server-only";
import { sweepEarlyLegs } from "./sweep";
import { getLegs, getParlay } from "./db";
import { seasonNow } from "./season";
import { expectedPickers } from "./jobs";
import { gameOdds, allProps, flatten, lineKey, oddsEnabled, propsSource, GAME_MARKETS, type BoardLine } from "./odds";
import type { Member } from "./sleeper";
import { canEditLeg } from "./legrules";

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
  enteredBy: string | null;
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
    enteredBy: l.entered_by,
  }));
}

export async function boardData(me: Member, all: Member[], forUser?: string): Promise<BoardData> {
  await sweepEarlyLegs().catch(() => null);
  const now = await seasonNow();
  // Anyone can enter a leg for a pool member who has none (the person placing
  // it often collects picks by text), or replace one someone else entered.
  // A leg the owner picked himself is his (see lib/legrules).
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
  const targetLeg = legs.find((l) => l.userId === target.userId);
  const ctx = { viewerId: me.userId, isAdmin: me.isAdmin, locked: now.locked, placed };
  const canRemove = !!targetLeg && canEditLeg({ userId: targetLeg.userId, enteredBy: targetLeg.enteredBy }, ctx);
  const canPick =
    !placed &&
    (me.isAdmin ||
      (isPicker && (targetLeg ? canRemove : forOther || !now.locked)));
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
