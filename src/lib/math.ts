// Parlay and loser math. Pure functions, no imports.

export function americanToDecimal(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) return 0;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

export function formatAmerican(american: number | null | undefined): string {
  if (american == null || !Number.isFinite(american)) return "—";
  return american > 0 ? `+${american}` : `${american}`;
}

/**
 * Combined parlay price from each leg's American odds.
 * Legs without a price are skipped and reported, so the estimate stays honest.
 */
export function parlayOdds(prices: Array<number | null | undefined>) {
  const priced = prices.filter((p): p is number => typeof p === "number" && p !== 0);
  const decimal = priced.reduce((acc, p) => acc * americanToDecimal(p), 1);
  return {
    decimal,
    american: priced.length ? decimalToAmerican(decimal) : null,
    pricedLegs: priced.length,
    unpricedLegs: prices.length - priced.length,
  };
}

export function payout(stake: number, decimal: number): number {
  return Math.round(stake * decimal * 100) / 100;
}

export type MatchupRow = { roster_id: number; points: number | null };

/**
 * Lowest scorer(s) for a finished week. Ties return every tied roster.
 * Rosters with no points recorded are ignored (bye or empty league slot).
 */
export function lowestScorers(rows: MatchupRow[]): { rosterIds: number[]; points: number } | null {
  const scored = rows.filter((r) => typeof r.points === "number" && r.points > 0);
  if (!scored.length) return null;
  const min = Math.min(...scored.map((r) => r.points as number));
  // Compare at hundredths, the precision Sleeper displays.
  const rosterIds = scored
    .filter((r) => Math.round((r.points as number) * 100) === Math.round(min * 100))
    .map((r) => r.roster_id);
  return { rosterIds, points: min };
}

/** Lowest scorer among the teams in the pool only. */
export function lowestInPool(rows: MatchupRow[], poolRosterIds: Set<number>) {
  return lowestScorers(rows.filter((r) => poolRosterIds.has(r.roster_id)));
}
