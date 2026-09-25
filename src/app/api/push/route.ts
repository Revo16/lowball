import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { removeSubscription, saveSubscription, type PushSub } from "@/lib/push";

export const dynamic = "force-dynamic";

// POST: register this phone for notifications. DELETE: turn them off.
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "signed out" }, { status: 401 });
  try {
    await saveSubscription(userId, (await req.json()) as PushSub);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  if (!(await currentUserId())) return NextResponse.json({ error: "signed out" }, { status: 401 });
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) await removeSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
