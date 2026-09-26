// Who can change or remove a leg that's already on the slip. Pure, so the
// server actions, the pages and the tests all use the same rule.
//
//  - A leg the owner picked himself is his alone: only he can change or remove
//    it, until the Saturday lock. (The admin can still fix it.)
//  - A leg someone entered for the owner is fair game: anyone in the league can
//    change or remove it, until the parlay is placed.
//  - Once the parlay is placed, nobody changes anything.

export type LegOwner = { userId: string; enteredBy: string | null };
export type LegRuleCtx = { viewerId: string; isAdmin: boolean; locked: boolean; placed: boolean };

export function canEditLeg(leg: LegOwner, c: LegRuleCtx): boolean {
  if (c.placed) return false;
  if (c.isAdmin) return true;
  if (leg.enteredBy) return true;
  return leg.userId === c.viewerId && !c.locked;
}

/** Why canEditLeg said no, in words for a toast. */
export function editBlockedReason(leg: LegOwner, c: LegRuleCtx, teamName: string): string {
  if (c.placed) return "This week's parlay is already placed.";
  if (leg.userId === c.viewerId) return "Picks are locked.";
  return `${teamName} picked that leg themselves, so only they can change it.`;
}

// Early games (Thursday night, Saturday or London games): a game can go on the
// slip until 15 minutes before kickoff. If the parlay still isn't placed by
// then, legs on that game come off, since DraftKings won't take a started game.
export const CUTOFF_MIN = 15;
const CUTOFF_MS = CUTOFF_MIN * 60_000;

/** When picks on a game close (and its legs drop if the parlay isn't placed). */
export function cutoffFor(commence: Date | string): Date {
  return new Date(new Date(commence).getTime() - CUTOFF_MS);
}

/** Can a game still go on the slip? */
export function isPickable(commence: Date | string, now = new Date()): boolean {
  return now.getTime() < cutoffFor(commence).getTime();
}

/** Should this leg come off the slip right now? Custom legs without a game never drop. */
export function shouldDrop(commence: string | null, placed: boolean, now = new Date()): boolean {
  return !placed && !!commence && !isPickable(commence, now);
}

/** An "early" leg: its cutoff comes before the Saturday lock, so it can drop. */
export function isEarly(commence: string | null, lock: Date): boolean {
  return !!commence && cutoffFor(commence).getTime() < lock.getTime();
}
