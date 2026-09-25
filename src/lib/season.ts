import "server-only";
import { nflState } from "./sleeper";
import { completedWeek, parlayWeek, lockTime, weekEnd } from "./weeks";

/** Where we are in the season, computed from Sleeper's calendar. */
export async function seasonNow(now = new Date()) {
  const state = await nflState();
  const start = state.season_start_date;
  const week = parlayWeek(start, now);
  const lock = lockTime(start, week);
  return {
    season: state.season,
    seasonStart: start,
    inSeason: state.season_type === "regular" || state.season_type === "post",
    week,                                    // parlay being picked now
    lastCompleted: completedWeek(start, now), // its loser funds `week`
    lock,
    windowEnd: weekEnd(start, week),
    locked: now >= lock,
  };
}

export type SeasonNow = Awaited<ReturnType<typeof seasonNow>>;
