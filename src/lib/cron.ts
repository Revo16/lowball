import "server-only";
import { NextResponse } from "next/server";
import { config } from "./config";
import { claimMessage, releaseMessage } from "./db";
import { notify } from "./notify";

export function authorized(req: Request) {
  return req.headers.get("authorization") === `Bearer ${config.cronSecret}`;
}

/** Sends a group-chat message once per key, even if the cron fires twice. */
export async function sendOnce(key: string, text: string | null) {
  if (!text) return NextResponse.json({ ok: true, skipped: "nothing to send" });
  if (!(await claimMessage(key))) return NextResponse.json({ ok: true, skipped: "already sent", key });
  try {
    const { sent } = await notify(text);
    return NextResponse.json({ ok: true, key, sent, text });
  } catch (err) {
    await releaseMessage(key); // let the next run retry
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
