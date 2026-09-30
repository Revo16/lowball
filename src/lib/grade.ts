// Grading a leg against the live game: pure, so it's tested in logic.test.ts.
//
// Inputs are the game's score/status (from ESPN's scoreboard) and a box score
// of player stats (from ESPN's game summary). Output is what the card shows:
// where the leg stands right now and, once it can't change, hit / miss / push.
//
// A leg is decided as early as the result is certain: an Over that's already
// cleared its line has hit even in the 2nd quarter; an Under that's been passed
// has missed. Spreads, moneylines and Unders wait for the final.

export type GameState = "pre" | "in" | "post";
export type Side = { name: string; abbr: string; score: number };
export type LiveGame = { state: GameState; detail: string; home: Side; away: Side };
/** Player stats keyed "group.key", e.g. "receiving.receivingYards". */
export type PlayerStats = Record<string, number>;
export type Box = {
  /** normName(player) -> stats */
  players: Map<string, PlayerStats>;
  /** normName of the first touchdown scorer; null if no TD yet; undefined if the feed didn't say. */
  firstTd?: string | null;
};
export type LegIn = {
  market: string;
  outcome_name: string | null;
  outcome_desc: string | null;
  point: number | null;
};
export type Result = "hit" | "miss" | "push";
export type Grade = {
  state: GameState;
  /** Set once the leg can't change. */
  result: Result | null;
  /** While it's live: on track or not. */
  trend: "good" | "bad" | null;
  /** For stat lines: how far along. */
  progress: { current: number; target: number } | null;
  /** "62 / 74.5 rec yds", "Seahawks lead by 3", "No TD yet". */
  text: string;
  /** Can't be graded automatically (typed-in bets, unknown stats): someone marks it. */
  manual: boolean;
};

/** "D.J. Moore", "DJ Moore" and "Kenneth Walker III" / "Kenneth Walker" all match. */
export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z]/g, "");
}

function nick(team: string) {
  return team.trim().split(/\s+/).slice(-1)[0].toLowerCase();
}
function sideOf(game: LiveGame, team: string | null): "home" | "away" | null {
  if (!team) return null;
  const t = team.toLowerCase();
  for (const s of ["home", "away"] as const) {
    const g = game[s];
    if (g.name.toLowerCase() === t || nick(g.name) === nick(team) || g.abbr.toLowerCase() === t) return s;
  }
  return null;
}

// Which box-score numbers make up each prop, and how to label them.
const TD_KEYS = [
  "rushing.rushingTouchdowns",
  "receiving.receivingTouchdowns",
  "kickReturns.kickReturnTouchdowns",
  "puntReturns.puntReturnTouchdowns",
  "defensive.defensiveTouchdowns",
];
const PROP_STATS: Record<string, { keys: string[]; unit: string }> = {
  player_pass_yds: { keys: ["passing.passingYards"], unit: "pass yds" },
  player_rush_yds: { keys: ["rushing.rushingYards"], unit: "rush yds" },
  player_reception_yds: { keys: ["receiving.receivingYards"], unit: "rec yds" },
  player_receiving_receptions: { keys: ["receiving.receptions"], unit: "catches" },
  player_receiving_touchdowns: { keys: ["receiving.receivingTouchdowns"], unit: "rec TD" },
  player_receiving_longestReception: { keys: ["receiving.longReception"], unit: "yd long catch" },
  player_passing_touchdowns: { keys: ["passing.passingTouchdowns"], unit: "pass TD" },
  player_passing_completions: { keys: ["passing.completions"], unit: "completions" },
  player_passing_attempts: { keys: ["passing.passingAttempts"], unit: "pass att" },
  player_passing_interceptions: { keys: ["passing.interceptions"], unit: "INT thrown" },
  player_rushing_attempts: { keys: ["rushing.rushingAttempts"], unit: "carries" },
  player_rushing_touchdowns: { keys: ["rushing.rushingTouchdowns"], unit: "rush TD" },
  player_rushing_longestRush: { keys: ["rushing.longRushing"], unit: "yd long run" },
  player_rushing_receiving_yards: { keys: ["rushing.rushingYards", "receiving.receivingYards"], unit: "rush+rec yds" },
  player_passing_rushing_yards: { keys: ["passing.passingYards", "rushing.rushingYards"], unit: "pass+rush yds" },
  player_defense_sacks: { keys: ["defensive.sacks"], unit: "sacks" },
  player_defense_combinedTackles: { keys: ["defensive.totalTackles"], unit: "tackles" },
  player_defense_soloTackles: { keys: ["defensive.soloTackles"], unit: "solo tackles" },
  player_defense_interceptions: { keys: ["interceptions.interceptions"], unit: "INT" },
  player_kicking_totalPoints: { keys: ["kicking.totalKickingPoints"], unit: "kick pts" },
  player_fieldGoals_made: { keys: ["kicking.fieldGoalsMade"], unit: "FG" },
  player_extraPoints_kicksMade: { keys: ["kicking.extraPointsMade"], unit: "XP" },
  player_touchdowns: { keys: TD_KEYS, unit: "TD" },
  player_anytime_td: { keys: TD_KEYS, unit: "TD" },
};

export function isGradable(market: string) {
  return (
    market === "h2h" ||
    market === "spreads" ||
    market === "totals" ||
    market === "team_total" ||
    market === "player_firstTouchdown" ||
    market in PROP_STATS
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function base(state: GameState): Grade {
  return { state, result: null, trend: null, progress: null, text: "", manual: false };
}

/** Over/Under on a running number (stat, team score, game total). */
function overUnder(state: GameState, side: string | null, current: number, line: number, unit: string): Grade {
  const g = base(state);
  const over = (side ?? "").toLowerCase() !== "under";
  g.progress = { current, target: line };
  const done = state === "post";
  if (over) {
    if (current > line) g.result = "hit";
    else if (done) g.result = current === line ? "push" : "miss";
    g.text = `${fmt(current)} / ${fmt(line)} ${unit}`;
    // To clear 74.5 you need 75; to clear a whole-number line you need one more.
    if (!g.result && state === "in") g.text += ` · needs ${fmt(Math.max(0, Math.floor(line) + 1 - current))}`;
  } else {
    if (current > line) g.result = "miss";
    else if (done) g.result = current === line ? "push" : "hit";
    g.text = `${fmt(current)} of ${fmt(line)} ${unit}`;
    if (!g.result && state === "in") {
      g.text += ` · ${fmt(line - current)} to spare`;
      g.trend = "good";
    }
  }
  return g;
}

export function gradeLeg(leg: LegIn, game: LiveGame | null, box: Box | null): Grade {
  if (!game) return { ...base("pre"), manual: !isGradable(leg.market) };
  const state = game.state;
  if (state === "pre") return { ...base("pre"), manual: !isGradable(leg.market) };
  const done = state === "post";

  switch (leg.market) {
    case "h2h": {
      const s = sideOf(game, leg.outcome_name);
      if (!s) return { ...base(state), manual: true, text: "Couldn't match the team" };
      const me = game[s].score;
      const them = game[s === "home" ? "away" : "home"].score;
      const g = base(state);
      if (done) g.result = me > them ? "hit" : me < them ? "miss" : "push";
      else g.trend = me > them ? "good" : me < them ? "bad" : null;
      const who = game[s].name.split(" ").slice(-1)[0];
      g.text = me === them ? `Tied ${me}–${them}` : me > them ? `${who} ${done ? "won" : "lead"} ${me}–${them}` : `${who} ${done ? "lost" : "trail"} ${me}–${them}`;
      return g;
    }
    case "spreads": {
      const s = sideOf(game, leg.outcome_name);
      if (!s || leg.point == null) return { ...base(state), manual: true, text: "Couldn't match the team" };
      const margin = game[s].score - game[s === "home" ? "away" : "home"].score + leg.point;
      const g = base(state);
      if (done) g.result = margin > 0 ? "hit" : margin < 0 ? "miss" : "push";
      else g.trend = margin > 0 ? "good" : margin < 0 ? "bad" : null;
      g.text = margin > 0 ? `Covering by ${fmt(margin)}` : margin < 0 ? `Needs ${fmt(-margin)} more` : "Right on the number";
      return g;
    }
    case "totals": {
      if (leg.point == null) return { ...base(state), manual: true };
      return overUnder(state, leg.outcome_name, game.home.score + game.away.score, leg.point, "pts");
    }
    case "team_total": {
      const s = sideOf(game, leg.outcome_desc);
      if (!s || leg.point == null) return { ...base(state), manual: true, text: "Couldn't match the team" };
      return overUnder(state, leg.outcome_name, game[s].score, leg.point, "pts");
    }
    case "player_firstTouchdown": {
      const g = base(state);
      const who = normName(leg.outcome_desc ?? "");
      if (!box || box.firstTd === undefined) return { ...g, manual: true };
      if (box.firstTd) {
        g.result = box.firstTd === who ? "hit" : "miss";
        g.text = g.result === "hit" ? "Scored the first TD" : "Someone else scored first";
      } else {
        if (done) g.result = "push"; // no touchdowns in the game
        g.text = "No TD yet";
      }
      return g;
    }
  }

  const spec = PROP_STATS[leg.market];
  if (!spec) return { ...base(state), manual: true, text: done ? "Final: mark it by hand" : "Live: check it by hand" };
  const player = box?.players.get(normName(leg.outcome_desc ?? ""));
  if (!player) {
    // Not in the box score: hasn't touched the ball yet, or didn't play (void on DraftKings).
    const g = base(state);
    if (done) {
      g.result = "push";
      g.text = "Didn't play: leg voided";
    } else g.text = "No stats yet";
    return g;
  }
  const current = spec.keys.reduce((sum, k) => sum + (player[k] ?? 0), 0);
  const yes = (leg.outcome_name ?? "").toLowerCase() === "yes" || leg.market === "player_anytime_td";
  if (yes) {
    const g = base(state);
    if (current >= 1) g.result = "hit";
    else if (done) g.result = "miss";
    g.text = current >= 1 ? `Scored${current > 1 ? ` ${current} TDs` : ""}` : "No TD yet";
    return g;
  }
  if (leg.point == null) return { ...base(state), manual: true };
  return overUnder(state, leg.outcome_name, current, leg.point, spec.unit);
}

/** The parlay: lost the moment any leg misses; won once every leg is in and none missed. */
export function parlayOutcome(results: Array<Result | null>): "won" | "lost" | "void" | null {
  if (results.some((r) => r === "miss")) return "lost";
  if (!results.length || results.some((r) => r == null)) return null;
  return results.every((r) => r === "push") ? "void" : "won";
}
