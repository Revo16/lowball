// One-time check that both free odds feeds return what the app expects.
// Usage: SGO_API_KEY=your_key node scripts/check-odds.mjs
// Costs about one object per game on your SportsGameOdds allowance.

const espn = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard").then((r) => r.json());
const withDk = (espn.events ?? []).filter((e) =>
  e.competitions?.[0]?.odds?.some((o) => /draftkings/i.test(o.provider?.name ?? "") && o.pointSpread?.home?.close?.odds),
);
console.log(`ESPN: ${espn.events?.length ?? 0} games this week, ${withDk.length} with DraftKings lines`);
if (withDk[0]) {
  const o = withDk[0].competitions[0].odds[0];
  console.log("  e.g.", withDk[0].name, "| spread", o.pointSpread.home.close.line, o.pointSpread.home.close.odds, "| total", o.total.over.close.line);
}

const key = process.env.SGO_API_KEY;
if (!key) {
  console.log("\nSet SGO_API_KEY to check SportsGameOdds too.");
  process.exit(0);
}
const url = new URL("https://api.sportsgameodds.com/v2/events");
url.searchParams.set("leagueID", "NFL");
url.searchParams.set("bookmakerID", "draftkings");
url.searchParams.set("oddsAvailable", "true");
url.searchParams.set("limit", "3");
const res = await fetch(url, { headers: { "X-Api-Key": key } });
const body = await res.json();
if (!res.ok || body.success === false) {
  console.log("SportsGameOdds error:", res.status, body.error ?? body);
  process.exit(1);
}
const ev = body.data?.[0];
if (!ev) {
  console.log("SportsGameOdds: no upcoming NFL games with odds right now.");
  process.exit(0);
}
const odds = Object.values(ev.odds ?? {});
const dk = odds.filter((o) => o.byBookmaker?.draftkings);
const count = (re) => dk.filter((o) => re.test(o.oddID ?? "")).length;
console.log(`\nSportsGameOdds: ${ev.teams?.away?.names?.long} @ ${ev.teams?.home?.names?.long}, ${dk.length} DraftKings odds`);
console.log("  game lines   :", count(/^points-(home|away|all)-game-(ml|sp|ou)-/));
console.log("  anytime TD   :", count(/^touchdowns-.+-game-(yn-yes|ou-over)$/));
console.log("  passing yds  :", count(/^passing_yards-.+-game-ou-/));
console.log("  rushing yds  :", count(/^rushing_yards-.+-game-ou-/));
console.log("  receiving yds:", count(/^receiving_yards-.+-game-ou-/));

// Every player prop type DraftKings has on this game, full game only. The app
// now shows all of these (each statID becomes its own market).
const propTypes = new Map();
for (const o of dk) {
  const ent = o.statEntityID ?? "";
  if (["home", "away", "all"].includes(ent) || (o.periodID ?? "game") !== "game") continue;
  const k = `${o.statID} (${o.betTypeID})`;
  propTypes.set(k, (propTypes.get(k) ?? 0) + 1);
}
console.log(`\nAll DraftKings player prop types on this game (${propTypes.size}):`);
for (const [k, n] of [...propTypes].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(40)} ${n}`);
const sample = dk.find((o) => /^receiving_yards-/.test(o.oddID ?? "")) ?? dk[0];
console.log("\nSample odd (the app reads statID, statEntityID, betTypeID, sideID and byBookmaker.draftkings):");
console.log(JSON.stringify({ ...sample, byBookmaker: { draftkings: sample.byBookmaker.draftkings } }, null, 2));
const pid = sample.statEntityID;
console.log("Player name for", pid, "->", ev.players?.[pid]?.name ?? "(missing: app falls back to a cleaned-up ID)");
console.log("\nIf the prop counts above are 0 but the sample shows DraftKings props, send the sample to whoever maintains the app.");
