import "server-only";
import webpush from "web-push";
import { db } from "./db";

// Web push to phones that turned on notifications in the app.
// iPhone: only works once Lowball is added to the Home Screen (iOS 16.4+).
// Android/desktop: works in the browser.
// Keys: `npx web-push generate-vapid-keys`, then set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.

export function pushPublicKey() {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

export function pushEnabled() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let configured = false;
function setup() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:lowball@example.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function saveSubscription(userId: string, sub: PushSub) {
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) {
    throw new Error("That doesn't look like a push subscription.");
  }
  const res = await db().from("push_subs").upsert({
    endpoint: sub.endpoint,
    user_id: userId,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
  });
  if (res.error) throw new Error(`Couldn't save notifications: ${res.error.message}`);
}

export async function removeSubscription(endpoint: string) {
  await db().from("push_subs").delete().eq("endpoint", endpoint);
}

export async function subscribedUserIds(): Promise<Set<string>> {
  const r = await db().from("push_subs").select("user_id");
  return new Set(((r.data ?? []) as Array<{ user_id: string }>).map((x) => x.user_id));
}

export type PushMessage = { title: string; body: string; url?: string; tag?: string };

/**
 * Sends to every phone each user has registered.
 * Returns who got it and who has notifications off.
 */
export async function pushTo(userIds: string[], msg: PushMessage) {
  if (!pushEnabled() || !userIds.length) return { reached: [] as string[], off: userIds };
  setup();
  const r = await db().from("push_subs").select("endpoint, user_id, p256dh, auth");
  const subs = ((r.data ?? []) as Array<{ endpoint: string; user_id: string; p256dh: string; auth: string }>).filter((s) =>
    userIds.includes(s.user_id),
  );
  const reached = new Set<string>();
  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url ?? "/", tag: msg.tag ?? "lowball" });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 60 * 60 * 6,
          urgency: "high",
        });
        reached.add(s.user_id);
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        // 404/410: the phone unsubscribed or the app was deleted. Forget it.
        if (code === 404 || code === 410) await removeSubscription(s.endpoint);
      }
    }),
  );
  return { reached: [...reached], off: userIds.filter((id) => !reached.has(id)) };
}
