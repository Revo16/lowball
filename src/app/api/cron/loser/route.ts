import { NextResponse } from "next/server";
import { authorized, sendOnce } from "@/lib/cron";
import { seasonNow } from "@/lib/season";
import { recordLosers, loserMessage } from "@/lib/jobs";

export const dynamic = "force-dynamic";

// Tuesday morning: find last week's lowest scorer, save it, tell the group.
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = await seasonNow();
  const week = now.lastCompleted;
  if (!now.inSeason || week < 1) return NextResponse.json({ ok: true, skipped: "no completed week" });

  const result = await recordLosers(now.season, week);
  if (!result) return NextResponse.json({ ok: true, skipped: `no scores for week ${week}` });
  return sendOnce(`loser:${now.season}:${week}`, await loserMessage(now.season, week));
}
