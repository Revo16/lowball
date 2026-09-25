import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { members } from "@/lib/sleeper";
import { slipData } from "@/lib/slip";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "signed out" }, { status: 401 });
  const all = await members();
  const me = all.find((m) => m.userId === userId);
  if (!me) return NextResponse.json({ error: "signed out" }, { status: 401 });
  try {
    return NextResponse.json(await slipData(me, all), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
