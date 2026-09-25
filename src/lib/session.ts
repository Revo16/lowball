import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "./config";
import { members, type Member } from "./sleeper";

// A signed cookie holding the Sleeper user_id. The league PIN is the only
// secret; picking your team name is the "username". Fine for 12 friends,
// not meant for anything with real money stored in it.

const COOKIE = "lowball_session";
const MAX_AGE = 60 * 60 * 24 * 180; // one season

function sign(value: string) {
  return createHmac("sha256", config.sessionSecret).update(value).digest("base64url");
}

export async function setSession(userId: string) {
  const jar = await cookies();
  jar.set(COOKIE, `${userId}.${sign(userId)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUserId(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [userId, sig] = raw.split(".");
  if (!userId || !sig) return null;
  const expected = Buffer.from(sign(userId));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return userId;
}

/** The signed-in member, or a redirect to /login. */
export async function requireMember(): Promise<{ me: Member; all: Member[] }> {
  const userId = await currentUserId();
  if (!userId) redirect("/login");
  const all = await members();
  const me = all.find((m) => m.userId === userId);
  if (!me) redirect("/login");
  return { me, all };
}

export async function requireAdmin() {
  const ctx = await requireMember();
  if (!ctx.me.isAdmin) redirect("/");
  return ctx;
}

export function pinMatches(pin: string) {
  const a = Buffer.from(pin.trim());
  const b = Buffer.from(config.leaguePin);
  return a.length === b.length && timingSafeEqual(a, b);
}
