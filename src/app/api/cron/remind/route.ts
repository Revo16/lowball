import { NextResponse } from "next/server";
import { authorized, sendOnce } from "@/lib/cron";
import { seasonNow } from "@/lib/season";
import { expectedPickers, reminderMessage } from "@/lib/jobs";
import { claimMessage, getLegs } from "@/lib/db";
import { members } from "@/lib/sleeper";
import { pushEnabled, pushTo } from "@/lib/push";
import { formatPt } from "@/lib/weeks";

export const dynamic = "force-dynamic";

// Friday evening and Saturday noon: group chat post plus a push to each
// pool member who hasn't picked.
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const slot = new URL(req.url).searchParams.get("slot") ?? "manual";
  const now = await seasonNow();
  if (!now.inSeason || now.locked) return NextResponse.json({ ok: true, skipped: "offseason or locked" });

  let pushed: string[] = [];
  if (pushEnabled() && (await claimMessage(`remind-push:${now.season}:${now.week}:${slot}`))) {
    const all = await members();
    const [legs, pickers] = await Promise.all([getLegs(now.season, now.week), expectedPickers(now.season, now.week, all)]);
    const have = new Set(legs.map((l) => l.user_id));
    const missing = pickers.filter((p) => !have.has(p.userId)).map((p) => p.userId);
    pushed = (
      await pushTo(missing, {
        title: `Week ${now.week}: you haven't picked`,
        body: `Picks lock ${formatPt(now.lock)}.`,
        url: "/search",
        tag: `remind-${now.week}`,
      })
    ).reached;
  }
  const chat = await sendOnce(`remind:${now.season}:${now.week}:${slot}`, await reminderMessage());
  const body = await chat.json();
  return NextResponse.json({ ...body, pushed: pushed.length });
}
