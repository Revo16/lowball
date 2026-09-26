import "server-only";
import { sweepEarlyLegs } from "./sweep";
import { config } from "./config";
import { getLegs, getLosers, getParlay, getParlays, type Leg } from "./db";
import { liveBottom, avatarUrl, type Member } from "./sleeper";
import { seasonNow } from "./season";
import { expectedPickers, stakeFor } from "./jobs";
import { americanToDecimal, parlayOdds, payout } from "./math";
import { gameOdds, propSlate, dkMarkets, currentPrice, isPropMarket, MARKET_LABEL, type Market, type OddsWindow } from "./odds";
import { venmoPayLink } from "./venmo";
import { venmos } from "./venmos";
import { canEditLeg, cutoffFor, isEarly } from "./legrules";

// Everything The Slip page shows, as plain JSON. The page renders it once on
// the server and then re-fetches it every 30 seconds.

export type SlipLeg = {
  selection: string;
  game: string;
  market: string;
  marketLabel: string;
  kickoff: string | null;
  pickPrice: number | null;
  livePrice: number | null;
  status: "live" | "moved" | "gone" | "custom" | "frozen" | "unknown";
  movedTo: string | null;
  /** DraftKings' new main-line number when it moved off the picked one. */
  movedPoint: number | null;
  enteredBy: string | null;
  /** Early game: when it comes off the slip if the parlay isn't placed. */
  dropsAt: string | null;
};

export type SlipRow = {
  userId: string;
  teamName: string;
  username: string;
  avatar: string | null;
  isMe: boolean;
  leg: SlipLeg | null;
  /** Filled: the viewer may change (tap) or remove (swipe left) it. See lib/legrules. */
  canEdit: boolean;
  /** Empty: the viewer may add a pick here (their own before the lock, anyone else's until placed). */
  canAdd: boolean;
  /** Where tapping goes: Find a bet for yourself, or picking for them. */
  href: string;
};

export type SlipData = {
  week: number;
  season: string;
  lock: string;
  locked: boolean;
  status: "open" | "locked" | "placed" | "won" | "lost" | "void";
  rows: SlipRow[];
  picked: number;
  needed: number;
  totals: {
    atPick: number | null;
    live: number | null;
    final: number | null;
    stake: number;
    toWin: number | null;
    unpriced: number;
  };
  odds: { at: string | null; stale: boolean; note: string | null };
  lastPlace: {
    week: number;
    points: number;
    people: Array<{ userId: string; teamName: string; username: string; avatar: string | null; state: "owes" | "says-paid" | "paid" }>;
    /** Who they pay: whoever placed the parlay their $5 funds. Null until it's placed. */
    bookie: string | null;
  } | null;
  myDebts: Array<{
    week: number;
    points: number;
    tied: boolean;
    /** The week they fund (week + 1) and who placed it. Null bookie = not placed yet. */
    funds: number;
    bookie: { teamName: string; avatar: string | null; venmo: string | null } | null;
    venmoUrl: string | null;
  }>;
  liveLast: { teamName: string; points: number } | null;
  winnings: {
    payout: number | null;      // what DraftKings pays back if it hits (stake included)
    perPerson: number | null;
    split: number;              // people on the slip
  };
  /** The admin, for "ask them to add you". */
  payTo: { teamName: string | null };
  placedBy: string | null;
  /** This week's bookie: whoever tapped I placed it. Null until then. */
  bookie: { userId: string; teamName: string; avatar: string | null; isMe: boolean; venmo: string | null } | null;
  amount: number;
  parlayNote: string | null;
  me: { userId: string; teamName: string; avatar: string | null; isAdmin: boolean; inPool: boolean; picks: boolean; canRemove: boolean };
  leagueSize: number;
  updatedAt: string;
};

function payState(l: { paid: boolean; confirmed: boolean }) {
  return l.confirmed ? "paid" : l.paid ? "says-paid" : "owes";
}

/** Live DraftKings prices for every picked leg. Only fetches what the slip uses. */
async function livePrices(legs: Leg[], w: OddsWindow) {
  const byEvent = new Map<string, Market[]>();
  let at: Date | null = null;
  let stale = false;
  let note: string | null = null;
  const older = (d: Date | null) => {
    if (d && (!at || d < at)) at = d;
  };

  if (legs.some((l) => l.event_id && !isPropMarket(l.market) && l.market !== "custom")) {
    try {
      const g = await gameOdds(w);
      for (const e of g.events) byEvent.set(e.id, dkMarkets(e));
      older(g.fetchedAt);
      stale ||= g.stale;
    } catch (err) {
      note = (err as Error).message;
    }
  }
  if (legs.some((l) => l.event_id && isPropMarket(l.market))) {
    const p = await propSlate(w);
    if (p.error) note = p.error;
    for (const e of p.events) byEvent.set(e.id, [...(byEvent.get(e.id) ?? []), ...dkMarkets(e)]);
    older(p.fetchedAt);
    stale ||= p.stale;
  }
  return { byEvent, at: at as Date | null, stale, note };
}

export async function slipData(me: Member, all: Member[]): Promise<SlipData> {
  await sweepEarlyLegs().catch(() => null);
  const now = await seasonNow();
  const [legs, losers, parlay, parlays, pickers, stake] = await Promise.all([
    getLegs(now.season, now.week),
    getLosers(now.season),
    getParlay(now.season, now.week),
    getParlays(now.season),
    expectedPickers(now.season, now.week, all),
    stakeFor(now.season, now.week),
  ]);
  const byId = new Map(all.map((m) => [m.userId, m]));
  const status: SlipData["status"] =
    parlay?.status && parlay.status !== "open" ? parlay.status : now.locked ? "locked" : "open";
  const frozen = status === "placed" || status === "won" || status === "lost" || status === "void";

  // Once someone has placed it, the price is set. Stop tracking.
  const live = frozen || !legs.length
    ? { byEvent: new Map<string, Market[]>(), at: null, stale: false, note: null }
    : await livePrices(legs, now);

  const legByUser = new Map(legs.map((l) => [l.user_id, l]));
  const toSlipLeg = (l: Leg): SlipLeg => {
    const base = {
      selection: l.selection,
      game: l.game,
      market: l.market,
      marketLabel: MARKET_LABEL[l.market] ?? l.market,
      kickoff: l.commence_time,
      pickPrice: l.price,
      livePrice: null as number | null,
      movedTo: null as string | null,
      movedPoint: null as number | null,
      enteredBy: l.entered_by ? byId.get(l.entered_by)?.teamName ?? "someone" : null,
      dropsAt: !frozen && isEarly(l.commence_time, now.lock) ? cutoffFor(l.commence_time!).toISOString() : null,
    };
    if (l.market === "custom" || !l.event_id) return { ...base, status: "custom" };
    if (frozen) return { ...base, status: "frozen" };
    const markets = live.byEvent.get(l.event_id);
    if (!markets) return { ...base, status: "unknown" };
    const p = currentPrice(
      { market: l.market, outcome_name: l.outcome_name, outcome_desc: l.outcome_desc, point: l.point },
      markets,
    );
    if (p.status === "gone") return { ...base, status: "gone" };
    if (p.status === "moved") return { ...base, status: "moved", livePrice: p.price, movedTo: p.label, movedPoint: p.point };
    return { ...base, status: "live", livePrice: p.price };
  };

  // Picked legs by kickoff, then the blanks.
  const people = [...pickers];
  for (const l of legs) if (!people.some((p) => p.userId === l.user_id) && byId.has(l.user_id)) people.push(byId.get(l.user_id)!);
  const rows: SlipRow[] = people
    .map((m) => {
      const isMe = m.userId === me.userId;
      const l = legByUser.get(m.userId);
      return {
        userId: m.userId,
        teamName: m.teamName,
        username: m.username,
        avatar: avatarUrl(m.avatar),
        isMe,
        leg: l ? toSlipLeg(l) : null,
        canEdit: !!l && canEditLeg({ userId: m.userId, enteredBy: l.entered_by }, { viewerId: me.userId, isAdmin: me.isAdmin, locked: now.locked, placed: frozen }),
        canAdd: !l && !frozen && (isMe ? !now.locked || me.isAdmin : true),
        href: isMe ? "/search" : `/search?for=${m.userId}`,
      };
    })
    .sort((a, b) => {
      if (!a.leg !== !b.leg) return a.leg ? -1 : 1;
      if (!a.leg || !b.leg) return a.isMe !== b.isMe ? (a.isMe ? -1 : 1) : a.teamName.localeCompare(b.teamName);
      return (a.leg.kickoff ?? "9").localeCompare(b.leg.kickoff ?? "9");
    });

  const slipLegs = rows.map((r) => r.leg).filter((l): l is SlipLeg => !!l);
  const atPick = parlayOdds(slipLegs.map((l) => l.pickPrice));
  // A moved line means the picked number now costs something else on DraftKings,
  // so the estimate keeps the pick-time price for it.
  const liveCombo = parlayOdds(slipLegs.map((l) => (l.status === "live" ? l.livePrice : l.pickPrice)));
  const finalStake = Number(parlay?.stake ?? stake);
  const decimalForWin = parlay?.dk_odds
    ? americanToDecimal(parlay.dk_odds)
    : liveCombo.american != null
      ? liveCombo.decimal
      : null;

  const funding = losers.filter((l) => l.week === now.week - 1);
  // Scores exist once the week's first game kicks off (often before the lock).
  const bottom = await liveBottom(now.week, 1).catch(() => []);
  const admin = all.find((m) => m.isAdmin);

  // This week's payout split across everyone on the slip. (Season winnings
  // live on the League tab.)
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const weekPayout =
    parlay?.status === "won" && parlay.payout != null
      ? Number(parlay.payout)
      : decimalForWin
        ? payout(finalStake, decimalForWin)
        : null;
  const split = Math.max(1, rows.length);
  // A loser's $5 funds the next week's parlay, so they pay whoever placed it
  // (that week's bookie). Until someone places it there's nobody to pay yet.
  const handles = await venmos(admin?.userId).catch(() => new Map<string, string>());
  const bookieOf = (loserWeek: number) => {
    const p = parlays.find((x) => x.week === loserWeek + 1 && x.status !== "open" && x.placed_by);
    return p?.placed_by ?? null;
  };
  const myDebts: SlipData["myDebts"] = losers
    .filter((x) => x.user_id === me.userId && !x.paid && !x.confirmed && bookieOf(x.week) !== me.userId)
    .map((l) => {
      const bookieId = bookieOf(l.week);
      const venmo = bookieId ? handles.get(bookieId) ?? null : null;
      return {
        week: l.week,
        points: Number(l.points),
        tied: l.tied,
        funds: l.week + 1,
        bookie: bookieId ? { teamName: byId.get(bookieId)?.teamName ?? "The bookie", avatar: avatarUrl(byId.get(bookieId)?.avatar ?? null), venmo } : null,
        venmoUrl: venmo ? venmoPayLink({ to: venmo, amount: config.loserAmount, note: `Lowball Week ${l.week + 1} parlay 🧻` }) : null,
      };
    });
  return {
    week: now.week,
    season: now.season,
    lock: now.lock.toISOString(),
    locked: now.locked,
    status,
    rows,
    picked: legs.length,
    needed: pickers.length,
    totals: {
      atPick: atPick.american,
      live: frozen ? null : liveCombo.american,
      final: parlay?.dk_odds ?? null,
      stake: finalStake,
      toWin: decimalForWin ? Math.round((payout(finalStake, decimalForWin) - finalStake) * 100) / 100 : null,
      unpriced: atPick.unpricedLegs,
    },
    odds: { at: live.at ? new Date(live.at).toISOString() : null, stale: live.stale, note: live.note },
    lastPlace: funding.length
      ? {
          week: now.week - 1,
          points: Number(funding[0].points),
          people: funding.map((f) => ({ userId: f.user_id, teamName: byId.get(f.user_id)?.teamName ?? "?", username: byId.get(f.user_id)?.username ?? "", avatar: avatarUrl(byId.get(f.user_id)?.avatar ?? null), state: payState(f) })),
          bookie: (() => {
            const id = bookieOf(now.week - 1);
            return id ? byId.get(id)?.teamName ?? null : null;
          })(),
        }
      : null,
    myDebts,
    liveLast: bottom[0] && bottom[0].points > 0 ? { teamName: bottom[0].member.teamName, points: bottom[0].points } : null,
    winnings: {
      payout: weekPayout != null ? round2(weekPayout) : null,
      perPerson: weekPayout != null ? round2(weekPayout / split) : null,
      split,
    },
    payTo: { teamName: admin?.teamName ?? null },
    placedBy: parlay?.placed_by ? byId.get(parlay.placed_by)?.teamName ?? null : null,
    bookie: parlay?.placed_by && parlay.status !== "open"
      ? {
          userId: parlay.placed_by,
          teamName: byId.get(parlay.placed_by)?.teamName ?? "Someone",
          avatar: avatarUrl(byId.get(parlay.placed_by)?.avatar ?? null),
          isMe: parlay.placed_by === me.userId,
          venmo: handles.get(parlay.placed_by) ?? null,
        }
      : null,
    amount: config.loserAmount,
    parlayNote: parlay?.note ?? null,
    leagueSize: all.length,
    me: { userId: me.userId, teamName: me.teamName, avatar: avatarUrl(me.avatar), isAdmin: me.isAdmin, inPool: me.inPool, picks: pickers.some((p) => p.userId === me.userId),
      canRemove: legByUser.has(me.userId) && canEditLeg(
        { userId: me.userId, enteredBy: legByUser.get(me.userId)!.entered_by },
        { viewerId: me.userId, isAdmin: me.isAdmin, locked: now.locked, placed: frozen },
      ),
    },
    updatedAt: new Date().toISOString(),
  };
}
