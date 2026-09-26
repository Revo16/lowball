import { NextResponse } from "next/server";
import { authorized } from "@/lib/cron";
import { seasonNow } from "@/lib/season";
import { sweepEarlyLegs } from "@/lib/sweep";

export const dynamic = "force-dynamic";

// Right after Thursday's (and Sunday London's) cutoff: take legs on games that
// are about to start off the slip if the parlay isn't placed, and tell owners.
// The app also does this whenever anyone opens it, so a late cron is harmless.
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = await seasonNow();
  if (!now.inSeason) return NextResponse.json({ ok: true, skipped: "offseason" });
  const dropped = await sweepEarlyLegs();
  return NextResponse.json({ ok: true, dropped: dropped.map((l) => ({ user: l.user_id, selection: l.selection })) });
}
