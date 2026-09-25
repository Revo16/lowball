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
