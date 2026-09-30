import "server-only";
import { db, getLegs, getParlay, claimMessage, type Leg, type Parlay } from "./db";
import { gradeLegs, type LegLive } from "./live";
import { parlayOutcome, type Result } from "./grade";
import { americanToDecimal } from "./math";
import { expectedPickers } from "./jobs";
import { members } from "./sleeper";
import { pushTo } from "./push";
import { notify } from "./notify";

// Grades the week's legs live and settles the parlay by itself:
//  - lost the moment any leg misses,
//  - won once every leg has hit (pushes/voids drop out of the parlay),
// with the payout worked out and one push + group-chat post to the league.
// Legs the app can't grade (typed-in bets, stats ESPN doesn't carry) wait for
// the week's bookie or the admin to mark them Hit or Miss on the card.

const GRADE_KEY = (season: string, week: number, legId: string) => `grade:${season}:${week}:${legId}`;

/** Hand-marked results, for legs that can't be graded automatically (or to fix one). */
export async function manualGrades(season: string, week: number): Promise<Map<string, Result>> {
  const r = await db().from("odds_cache").select("key, payload").like("key", `grade:${season}:${week}:%`);
  const out = new Map<string, Result>();
  for (const row of (r.data ?? []) as Array<{ key: string; payload: { result?: Result } }>) {
    if (row.payload?.result) out.set(row.key.split(":").pop()!, row.payload.result);
  }
  return out;
}

export async function saveManualGrade(season: string, week: number, legId: string, result: Result | null) {
  const key = GRADE_KEY(season, week, legId);
  if (!result) await db().from("odds_cache").delete().eq("key", key);
  else await db().from("odds_cache").upsert({ key, payload: { result }, fetched_at: new Date().toISOString() });
}

export type SlipGrade = LegLive & { markedBy: "auto" | "hand" };

/** Every leg's live grade, with hand-marked results applied on top. */
export async function weekGrades(season: string, week: number, legs: Leg[]): Promise<Map<string, SlipGrade>> {
  const [auto, hand] = await Promise.all([
    gradeLegs(season, week, legs).catch(() => new Map<string, LegLive>()),
    manualGrades(season, week).catch(() => new Map<string, Result>()),
  ]);
  const out = new Map<string, SlipGrade>();
  for (const l of legs) {
    const g: LegLive = auto.get(l.id) ?? {
      state: "pre", result: null, trend: null, progress: null, text: "", manual: l.market === "custom", game: null,
    };
    const h = hand.get(l.id);
    out.set(l.id, h ? { ...g, result: h, markedBy: "hand" } : { ...g, markedBy: "auto" });
  }
  return out;
}

function payoutFor(parlay: Parlay, legs: Leg[], grades: Map<string, SlipGrade>): number | null {
  const stake = Number(parlay.stake ?? 0);
  if (!stake) return null;
  const hits = legs.filter((l) => grades.get(l.id)?.result === "hit");
  const pushes = legs.length - hits.length;
  // No pushes: DraftKings pays the placed odds. With a push, DraftKings reprices
  // without that leg, so rebuild the odds from the remaining legs.
  if (!pushes && parlay.dk_odds) return Math.round(stake * americanToDecimal(parlay.dk_odds) * 100) / 100;
  if (hits.some((l) => l.price == null)) return parlay.dk_odds ? Math.round(stake * americanToDecimal(parlay.dk_odds) * 100) / 100 : null;
  const dec = hits.reduce((d, l) => d * americanToDecimal(Number(l.price)), 1);
  return Math.round(stake * dec * 100) / 100;
}

/**
 * Settle the week's parlay if the legs decide it. Only touches a parlay that's
 * placed and unsettled, so a result the admin set by hand is never overwritten.
 */
export async function settleWeek(season: string, week: number, preload?: { legs: Leg[]; grades: Map<string, SlipGrade>; parlay: Parlay | null }) {
  const parlay = preload ? preload.parlay : await getParlay(season, week);
  if (!parlay || parlay.status !== "placed") return null;
  const legs = preload?.legs ?? (await getLegs(season, week));
  if (!legs.length) return null;
  const grades = preload?.grades ?? (await weekGrades(season, week, legs));
  const outcome = parlayOutcome(legs.map((l) => grades.get(l.id)?.result ?? null));
  if (!outcome) return null;

  const payout = outcome === "won" ? payoutFor(parlay, legs, grades) : outcome === "void" ? Number(parlay.stake ?? 0) : 0;
  const res = await db()
    .from("parlays")
    .update({ status: outcome, payout, settled_at: new Date().toISOString() })
    .match({ season, week, status: "placed" });
  if (res.error) return null;

  // Tell everyone once.
  if (await claimMessage(`settled:${season}:${week}`).catch(() => false)) {
    const all = await members();
    const byId = new Map(all.map((m) => [m.userId, m]));
    const people = (await expectedPickers(season, week, all)).map((m) => m.userId);
    const each = payout ? Math.round((payout / Math.max(1, legs.length)) * 100) / 100 : 0;
    let title: string;
    let body: string;
    if (outcome === "won") {
      title = `Week ${week} parlay HIT 🎉`;
      body = `$${payout?.toFixed(2)} back, $${each.toFixed(2)} each.`;
    } else if (outcome === "void") {
      title = `Week ${week} parlay voided`;
      body = "Every leg pushed or was voided, so the stake comes back.";
    } else {
      const miss = legs.find((l) => grades.get(l.id)?.result === "miss");
      title = `Week ${week} parlay missed`;
      body = miss ? `${byId.get(miss.user_id)?.teamName ?? "Someone"}'s leg missed: ${miss.selection}.` : "A leg missed.";
    }
    await pushTo(people, { title, body, url: "/", tag: `settled-${week}` }).catch(() => null);
    await notify(`${title}. ${body}`).catch(() => null);
  }
  return { outcome, payout };
}

