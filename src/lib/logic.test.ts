import { test } from "node:test";
import assert from "node:assert/strict";
import { completedWeek, parlayWeek, lockTime, weekEnd, week1Thursday } from "./weeks.ts";
import { americanToDecimal, decimalToAmerican, parlayOdds, payout, lowestScorers, lowestInPool } from "./math.ts";

// Sleeper reports season_start_date 2026-09-09 (a Wednesday); Week 1 kicks off Thu Sep 10.
const START = "2026-09-09";
const pt = (iso: string) => new Date(iso); // ISO strings below carry explicit offsets

test("week 1 Thursday", () => {
  assert.equal(week1Thursday(START), "2026-09-10");
});

test("completed week rolls over Tuesday 00:00 PT", () => {
  assert.equal(completedWeek(START, pt("2026-09-10T17:00:00-07:00")), 0); // TNF week 1
  assert.equal(completedWeek(START, pt("2026-09-14T23:59:00-07:00")), 0); // MNF week 1
  assert.equal(completedWeek(START, pt("2026-09-15T00:01:00-07:00")), 1);
  assert.equal(completedWeek(START, pt("2026-09-24T17:34:00-07:00")), 2); // today
  assert.equal(completedWeek(START, pt("2026-09-28T21:00:00-07:00")), 2); // MNF week 3
  assert.equal(completedWeek(START, pt("2026-09-29T09:00:00-07:00")), 3);
});

test("parlay week is the one after the completed week", () => {
  assert.equal(parlayWeek(START, pt("2026-09-24T17:34:00-07:00")), 3);
  assert.equal(parlayWeek(START, pt("2027-02-01T12:00:00-08:00")), 18); // capped
});

test("lock is Saturday 8pm PT in both PDT and PST", () => {
  assert.equal(lockTime(START, 3).toISOString(), "2026-09-27T03:00:00.000Z"); // Sat Sep 26, PDT
  assert.equal(lockTime(START, 10).toISOString(), "2026-11-15T04:00:00.000Z"); // Sat Nov 14, PST
  assert.equal(weekEnd(START, 3).toISOString(), "2026-09-29T07:00:00.000Z");
});

test("odds conversions", () => {
  assert.equal(americanToDecimal(-110).toFixed(4), "1.9091");
  assert.equal(americanToDecimal(150), 2.5);
  assert.equal(decimalToAmerican(2.5), 150);
  assert.equal(decimalToAmerican(1.5), -200);
});

test("parlay combines priced legs and counts unpriced ones", () => {
  const p = parlayOdds([-110, -110, null, 200]);
  assert.equal(p.pricedLegs, 3);
  assert.equal(p.unpricedLegs, 1);
  assert.equal(p.decimal.toFixed(3), (1.9091 * 1.9091 * 3).toFixed(3));
  assert.equal(payout(5, p.decimal), 54.67);
});

test("lowest scorer, from real No Shoes Nation Week 2 numbers", () => {
  const week2 = [
    { roster_id: 1, points: 140.82 }, { roster_id: 2, points: 175.32 },
    { roster_id: 3, points: 121.04 }, { roster_id: 4, points: 86.38 },
    { roster_id: 5, points: 103.98 }, { roster_id: 6, points: 70.28 },
    { roster_id: 7, points: 94.4 },   { roster_id: 8, points: 123.96 },
    { roster_id: 9, points: 75.7 },   { roster_id: 10, points: 99.36 },
    { roster_id: 11, points: 150.86 }, { roster_id: 12, points: 124.82 },
  ];
  assert.deepEqual(lowestScorers(week2), { rosterIds: [6], points: 70.28 });
});

test("ties return everyone tied; zero-point rows ignored", () => {
  assert.deepEqual(
    lowestScorers([{ roster_id: 1, points: 80.1 }, { roster_id: 2, points: 80.1 }, { roster_id: 3, points: 0 }]),
    { rosterIds: [1, 2], points: 80.1 },
  );
  assert.equal(lowestScorers([{ roster_id: 1, points: null }]), null);
});

import { currentPrice, conflictFor, flatten } from "./lines.ts";

const spreadMarket = [{ key: "spreads", outcomes: [
  { name: "Seattle Seahawks", price: -105, point: -3 },
  { name: "Arizona Cardinals", price: -115, point: 3 },
] }];

test("live price: same line, price changed", () => {
  const leg = { market: "spreads", outcome_name: "Seattle Seahawks", outcome_desc: null, point: -3 };
  assert.deepEqual(currentPrice(leg, spreadMarket), { status: "live", price: -105, point: -3 });
});

test("live price: main line moved from -2.5 to -3", () => {
  const leg = { market: "spreads", outcome_name: "Seattle Seahawks", outcome_desc: null, point: -2.5 };
  assert.deepEqual(currentPrice(leg, spreadMarket), { status: "moved", price: -105, point: -3, label: "Seahawks -3" });
});

test("live price: market pulled", () => {
  const leg = { market: "h2h", outcome_name: "Seattle Seahawks", outcome_desc: null, point: null };
  assert.deepEqual(currentPrice(leg, spreadMarket), { status: "gone" });
});

test("conflicts: same game line blocked, same player prop blocked, other markets fine", () => {
  const others = [
    { userId: "a", eventId: "g1", market: "spreads", desc: null },
    { userId: "b", eventId: "g1", market: "player_rush_yds", desc: "Kenneth Walker III" },
  ];
  assert.equal(conflictFor({ eventId: "g1", market: "spreads", desc: null }, others)?.userId, "a");
  assert.equal(conflictFor({ eventId: "g1", market: "player_rush_yds", desc: "Kenneth Walker III" }, others)?.userId, "b");
  assert.equal(conflictFor({ eventId: "g1", market: "player_rush_yds", desc: "Zach Charbonnet" }, others), null);
  assert.equal(conflictFor({ eventId: "g1", market: "totals", desc: null }, others), null);
  assert.equal(conflictFor({ eventId: null, market: "custom", desc: null }, others), null);
});

test("flatten builds searchable labels", () => {
  const lines = flatten({
    id: "g1", commence_time: "2026-09-27T20:05:00Z", home_team: "Arizona Cardinals", away_team: "Seattle Seahawks",
    bookmakers: [{ key: "draftkings", last_update: "", markets: [
      ...spreadMarket,
      { key: "player_reception_yds", outcomes: [{ name: "Over", description: "Jaxon Smith-Njigba", price: -115, point: 74.5 }] },
    ] }],
  });
  assert.deepEqual(lines.map((l) => l.label), ["Seahawks -3", "Cardinals +3", "Jaxon Smith-Njigba Over 74.5 receiving yards"]);
});

test("pool: Week 2 loser among the seven teams playing", () => {
  const week2 = [
    { roster_id: 1, points: 140.82 }, { roster_id: 2, points: 175.32 }, { roster_id: 3, points: 121.04 },
    { roster_id: 4, points: 86.38 }, { roster_id: 5, points: 103.98 }, { roster_id: 6, points: 70.28 },
    { roster_id: 7, points: 94.4 }, { roster_id: 8, points: 123.96 }, { roster_id: 9, points: 75.7 },
    { roster_id: 10, points: 99.36 }, { roster_id: 11, points: 150.86 }, { roster_id: 12, points: 124.82 },
  ];
  // Lone Wolf 12, Hogfather 4, Need for Shaheed 1, Slippin' Tony 2, 4KTREY 7, tobiechip 10, oy vey my ACL 11
  const pool = new Set([12, 4, 1, 2, 7, 10, 11]);
  assert.deepEqual(lowestInPool(week2, pool), { rosterIds: [4], points: 86.38 });
});

import { dkParlayLink } from "./lines.ts";

test("one DraftKings link for the whole parlay", () => {
  const link = dkParlayLink([
    "https://sportsbook.draftkings.com/event/34118180?outcomes=0ML84695613_1",
    null,
    "https://sportsbook.draftkings.com/event/34118999?outcomes=0HC84695700N450_3",
    "https://sportsbook.draftkings.com/event/34118180?outcomes=0ML84695613_1",
  ]);
  assert.equal(link, "https://sportsbook.draftkings.com/event/34118180?outcomes=0ML84695613_1+0HC84695700N450_3");
  assert.equal(dkParlayLink([null, "not a url"]), null);
});

import { canEditLeg } from "./legrules.ts";

test("leg edit rules", () => {
  const open = { viewerId: "a", isAdmin: false, locked: false, placed: false };
  const own = { userId: "a", enteredBy: null };
  const theirs = { userId: "b", enteredBy: null };
  const enteredForB = { userId: "b", enteredBy: "c" };
  const enteredForA = { userId: "a", enteredBy: "c" };
  // Self-picked: only the owner, until lock.
  assert.equal(canEditLeg(own, open), true);
  assert.equal(canEditLeg(own, { ...open, locked: true }), false);
  assert.equal(canEditLeg(theirs, open), false);
  // Entered for someone: anyone, lock or not, until placed.
  assert.equal(canEditLeg(enteredForB, open), true);
  assert.equal(canEditLeg(enteredForB, { ...open, locked: true }), true);
  assert.equal(canEditLeg(enteredForA, { ...open, locked: true }), true);
  assert.equal(canEditLeg(enteredForB, { ...open, placed: true }), false);
  // Admin can fix anything until placed.
  assert.equal(canEditLeg(theirs, { ...open, isAdmin: true, locked: true }), true);
  assert.equal(canEditLeg(theirs, { ...open, isAdmin: true, placed: true }), false);
});

import { cutoffFor, isPickable, shouldDrop, isEarly } from "./legrules.ts";

test("early-game cutoff: 15 minutes before kickoff", () => {
  const tnf = "2026-10-01T17:15:00-07:00"; // Thu 5:15 PM PT
  const lock = new Date("2026-10-03T20:00:00-07:00"); // Sat 8 PM PT
  assert.equal(cutoffFor(tnf).toISOString(), new Date("2026-10-01T17:00:00-07:00").toISOString());
  assert.equal(isPickable(tnf, new Date("2026-10-01T16:59:00-07:00")), true);
  assert.equal(isPickable(tnf, new Date("2026-10-01T17:00:00-07:00")), false);
  // Friday: Thursday's game is gone
  assert.equal(isPickable(tnf, new Date("2026-10-02T12:00:00-07:00")), false);
  // Drops at the cutoff unless placed; custom legs with no game never drop
  assert.equal(shouldDrop(tnf, false, new Date("2026-10-01T17:01:00-07:00")), true);
  assert.equal(shouldDrop(tnf, true, new Date("2026-10-01T17:01:00-07:00")), false);
  assert.equal(shouldDrop(tnf, false, new Date("2026-10-01T16:00:00-07:00")), false);
  assert.equal(shouldDrop(null, false, new Date("2026-10-05T00:00:00-07:00")), false);
  // Early = cutoff before the Saturday lock
  assert.equal(isEarly(tnf, lock), true);
  assert.equal(isEarly("2026-10-04T10:00:00-07:00", lock), false); // Sunday 10 AM
  assert.equal(isEarly(null, lock), false);
});

import { mapSgoEvent } from "./providers/sgo-map.ts";
import { selectionLabel, marketLabel, isPropMarket } from "./lines.ts";

test("SportsGameOdds: every DraftKings player prop comes through", () => {
  const dk = (odds: string, extra: Record<string, string> = {}) => ({ byBookmaker: { draftkings: { odds, available: true, ...extra } } });
  const ev = mapSgoEvent({
    eventID: "x",
    teams: { home: { names: { long: "Arizona Cardinals" } }, away: { names: { long: "Seattle Seahawks" } } },
    status: { startsAt: "2026-10-01T17:15:00-07:00" },
    players: { JSN_1_NFL: { name: "Jaxon Smith-Njigba" }, KW_1_NFL: { name: "Kenneth Walker III" } },
    odds: {
      a: { statID: "receiving_receptions", statEntityID: "JSN_1_NFL", periodID: "game", betTypeID: "ou", sideID: "over", ...dk("-120", { overUnder: "6.5" }) },
      b: { statID: "firstTouchdown", statEntityID: "KW_1_NFL", periodID: "game", betTypeID: "yn", sideID: "yes", ...dk("+650") },
      c: { statID: "touchdowns", statEntityID: "KW_1_NFL", periodID: "game", betTypeID: "yn", sideID: "yes", ...dk("+120") },
      d: { statID: "touchdowns", statEntityID: "KW_1_NFL", periodID: "game", betTypeID: "ou", sideID: "over", ...dk("+700", { overUnder: "1.5" }) },
      e: { statID: "points", statEntityID: "home", periodID: "game", betTypeID: "ou", sideID: "over", ...dk("-110", { overUnder: "23.5" }) },
      f: { statID: "rushing+receiving_yards", statEntityID: "KW_1_NFL", periodID: "game", betTypeID: "ou", sideID: "under", ...dk("-115", { overUnder: "88.5" }) },
      g: { statID: "rushing_yards", statEntityID: "KW_1_NFL", periodID: "1h", betTypeID: "ou", sideID: "over", ...dk("-110", { overUnder: "30.5" }) }, // first half: skipped
    },
  })!;
  const markets = Object.fromEntries(ev.bookmakers[0].markets.map((m) => [m.key, m.outcomes]));
  assert.deepEqual(Object.keys(markets).sort(), [
    "player_anytime_td", "player_firstTouchdown", "player_receiving_receptions", "player_rushing_receiving_yards", "player_touchdowns", "team_total",
  ]);
  assert.equal(selectionLabel("player_receiving_receptions", markets.player_receiving_receptions[0]), "Jaxon Smith-Njigba Over 6.5 receptions");
  assert.equal(selectionLabel("player_firstTouchdown", markets.player_firstTouchdown[0]), "Kenneth Walker III first TD");
  assert.equal(selectionLabel("player_touchdowns", markets.player_touchdowns[0]), "Kenneth Walker III Over 1.5 touchdowns");
  assert.equal(selectionLabel("team_total", markets.team_total[0]), "Cardinals Over 23.5 points");
  assert.equal(marketLabel("player_rushing_receiving_yards"), "Rush + rec yards");
  assert.equal(marketLabel("player_defense_someNewStat"), "Defense some new stat");
  assert.equal(isPropMarket("team_total"), true);
  assert.equal(isPropMarket("spreads"), false);
  assert.equal(isPropMarket("custom"), false);
  // Two hand-typed bets on one game never clash
  assert.equal(conflictFor({ eventId: "g1", market: "custom", desc: null }, [{ userId: "a", eventId: "g1", market: "custom", desc: null }]), null);
});
