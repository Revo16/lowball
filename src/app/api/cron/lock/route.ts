import { NextResponse } from "next/server";
import { authorized, sendOnce } from "@/lib/cron";
import { seasonNow } from "@/lib/season";
import { lockMessage } from "@/lib/jobs";

export const dynamic = "force-dynamic";

// Saturday night, after the 8 PM lock: post the final slip for the bookie.
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = await seasonNow();
  if (!now.inSeason) return NextResponse.json({ ok: true, skipped: "offseason" });
  return sendOnce(`lock:${now.season}:${now.week}`, await lockMessage());
}
