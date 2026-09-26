import "server-only";
import { config } from "./config";
import { db, getLegs, getLosers, type Leg } from "./db";
import { members, weekLosers, type Member } from "./sleeper";
import { seasonNow } from "./season";
import { parlayOdds, payout, formatAmerican } from "./math";
import { MARKET_LABEL } from "./odds";
import { formatPt } from "./weeks";

/** Who is expected to pick this week. */
export async function expectedPickers(season: string, week: number, all?: Member[]) {
  const people = all ?? (await members());
  let pickers = people.filter((m) => m.inPool);
  if (!config.loserPicks) {
    const funding = (await getLosers(season)).filter((l) => l.week === week - 1).map((l) => l.user_id);
    pickers = pickers.filter((m) => !funding.includes(m.userId));
  }
  return pickers;
}

/** Stake for a week's parlay: $5 from each loser of the week before. */
export async function stakeFor(season: string, week: number) {
  const losers = (await getLosers(season)).filter((l) => l.week === week - 1);
  return (losers.length || 1) * config.loserAmount;
}

/** Looks up and saves the lowest scorer(s) for a finished week. Safe to re-run. */
export async function recordLosers(season: string, week: number) {
  const result = await weekLosers(week);
  if (!result || !result.members.length) return null;

  const existing = (await getLosers(season)).filter((l) => l.week === week);
  const keep = new Set(result.members.map((m) => m.userId));

  // Stat corrections can change the loser; drop rows that no longer apply
  // unless that person already paid.
  for (const row of existing) {
    if (!keep.has(row.user_id) && !row.paid && !row.confirmed) {
      await db().from("losers").delete().match({ season, week, user_id: row.user_id });
    }
  }
  for (const m of result.members) {
    const prior = existing.find((r) => r.user_id === m.userId);
    const res = await db().from("losers").upsert({
      season,
      week,
      user_id: m.userId,
      points: result.points,
      tied: result.tied,
      paid: prior?.paid ?? false,
      confirmed: prior?.confirmed ?? false,
      paid_at: prior?.paid_at ?? null,
    });
    if (res.error) throw new Error(`Database error: ${res.error.message}`);
  }
  return result;
}

export function legLine(leg: Leg) {
  const odds = leg.price != null ? ` (${formatAmerican(leg.price)})` : "";
  const kind = leg.market === "custom" ? "" : ` · ${MARKET_LABEL[leg.market] ?? leg.market}`;
  return `${leg.selection}${odds} — ${leg.game}${kind}`;
}

/** Plain-text slip the bookie can read while building the bet in DraftKings. */
export async function slipText(season: string, week: number) {
  const [legs, people] = await Promise.all([getLegs(season, week), members()]);
  const byId = new Map(people.map((m) => [m.userId, m]));
  const stake = await stakeFor(season, week);
  const combo = parlayOdds(legs.map((l) => l.price));
  const sorted = [...legs].sort((a, b) => (a.commence_time ?? "9").localeCompare(b.commence_time ?? "9"));
  const lines = sorted.map((l, i) => `${i + 1}. ${legLine(l)}  [${byId.get(l.user_id)?.teamName ?? "?"}]`);
  const est =
    combo.american != null
      ? `Est. ${formatAmerican(combo.american)} · $${stake} to win ~$${(payout(stake, combo.decimal) - stake).toFixed(2)}` +
        (combo.unpricedLegs ? ` (${combo.unpricedLegs} leg${combo.unpricedLegs > 1 ? "s" : ""} without odds not counted)` : "")
      : "No priced legs yet";
  return { text: [`Week ${week} parlay — ${legs.length} legs`, ...lines, est].join("\n"), legs, stake, combo };
}

function link(path = "") {
  return config.appUrl ? `${config.appUrl}${path}` : "";
}

export async function loserMessage(season: string, week: number) {
  const result = await weekLosers(week);
  if (!result || !result.members.length) return null;
  const names = result.members.map((m) => m.teamName).join(" and ");
  const who = result.tied ? `${names} tied for last` : `${names} finished last`;
  const pay = `${result.tied ? "Each owes" : "Owes"} $${config.loserAmount} to whoever places the Week ${week + 1} parlay. The Pay button shows up in the app once it's placed.`;
  return [
    `Week ${week}: ${who} with ${result.points.toFixed(2)}.`,
    `${pay} ${link("/")}`,
    `Week ${week + 1} parlay is open. Picks lock Saturday 8 PM PT.`,
  ].join("\n");
}

export async function reminderMessage() {
  const now = await seasonNow();
  if (now.locked) return null;
  const [legs, people] = await Promise.all([getLegs(now.season, now.week), members()]);
  const pickers = await expectedPickers(now.season, now.week, people);
  const done = new Set(legs.map((l) => l.user_id));
  const missing = pickers.filter((m) => !done.has(m.userId));
  if (!missing.length) return null;
  return [
    `Week ${now.week} parlay: ${legs.length}/${pickers.length} legs in. Locks ${formatPt(now.lock)} PT.`,
    `Still need: ${missing.map((m) => m.teamName).join(", ")}`,
    link("/search"),
  ].filter(Boolean).join("\n");
}

export async function lockMessage() {
  const now = await seasonNow();
  if (!now.locked) return null;
  const { text } = await slipText(now.season, now.week);
  const [legs, people] = await Promise.all([getLegs(now.season, now.week), members()]);
  const pickers = await expectedPickers(now.season, now.week, people);
  const done = new Set(legs.map((l) => l.user_id));
  const missed = pickers.filter((m) => !done.has(m.userId)).map((m) => m.teamName);
  return [
    `Picks are locked. Whoever's in a DraftKings state: open the Bookie tab, tap Open parlay in DraftKings, place it, then tap I placed it.`,
    text,
    missed.length ? `No pick: ${missed.join(", ")}` : "",
    link("/bookie"),
  ].filter(Boolean).join("\n");
}
