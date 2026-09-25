import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { members } from "@/lib/sleeper";
import { boardLegs, boardProps } from "@/lib/board";

export const dynamic = "force-dynamic";

// GET /api/board?props=1 -> every player prop plus the current legs.
// GET /api/board         -> just the current legs (who has what).
export async function GET(req: Request) {
  if (!(await currentUserId())) return NextResponse.json({ error: "signed out" }, { status: 401 });
  const all = await members();
  const wantProps = new URL(req.url).searchParams.get("props") === "1";
  try {
    const [legs, props] = await Promise.all([boardLegs(all), wantProps ? boardProps() : Promise.resolve(null)]);
    return NextResponse.json({ legs, ...(props ?? {}) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
