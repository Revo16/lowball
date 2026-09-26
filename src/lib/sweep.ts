import "server-only";
import { db, getLegs, getParlay, claimMessage } from "./db";
import { seasonNow } from "./season";
import { pushTo } from "./push";
import { formatPt } from "./weeks";
import { cutoffFor, shouldDrop } from "./legrules";

// Takes legs off the slip once their game is 15 minutes from kickoff and the
// parlay still hasn't been placed (Thursday night games, mostly). Runs whenever
// anyone opens the app or places the bet, plus a cron after Thursday's cutoff,
// so the slip is right even if nobody is looking at the exact minute.

export async function sweepEarlyLegs(now = new Date()) {
  const s = await seasonNow(now);
  const parlay = await getParlay(s.season, s.week);
  const placed = !!parlay && parlay.status !== "open";
  if (placed) return [];
  const legs = await getLegs(s.season, s.week);
  const drop = legs.filter((l) => shouldDrop(l.commence_time, placed, now));
  if (!drop.length) return [];

  for (const l of drop) {
    await db().from("legs").delete().match({ season: s.season, week: s.week, user_id: l.user_id, id: l.id });
  }
  // Tell each owner once.
  await Promise.all(
    drop.map(async (l) => {
      const fresh = await claimMessage(`dropped:${s.season}:${s.week}:${l.user_id}:${l.id}`).catch(() => false);
      if (!fresh) return;
      await pushTo([l.user_id], {
        title: `Your Week ${s.week} leg came off the slip`,
        body: `${l.selection}: the parlay wasn't placed by ${formatPt(cutoffFor(l.commence_time!))}, 15 minutes before kickoff. Pick another game before ${formatPt(s.lock)}.`,
        url: "/search",
        tag: `leg-${s.week}`,
      }).catch(() => null);
    }),
  );
  return drop;
}
