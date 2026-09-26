import "server-only";
import { getLegs, type Parlay } from "./db";
import { americanToDecimal, payout } from "./math";

/**
 * Season winnings: every parlay that hit, what DraftKings paid back (stake
 * included), and each hit split across whoever was on that week's slip.
 */
export async function seasonWinnings(season: string, parlays: Parlay[]) {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  let total = 0;
  let each = 0;
  const hits = parlays.filter((p) => p.status === "won");
  for (const p of hits) {
    const paid =
      p.payout != null ? Number(p.payout) : p.stake != null && p.dk_odds ? payout(Number(p.stake), americanToDecimal(p.dk_odds)) : 0;
    const people = (await getLegs(season, p.week)).length || 1;
    total += paid;
    each += paid / people;
  }
  return { total: round2(total), perPerson: round2(each), hits: hits.length };
}
